import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const testPgDir = path.join(os.tmpdir(), `clinical-verify-${Date.now()}`);
delete process.env.DATABASE_URL;
process.env.CLINICAL_PGDATA_DIR = testPgDir;
process.env.TELEGRAM_WEBHOOK_SECRET = "verify-secret-token";
process.env.CRON_SECRET = "verify-cron-secret";

import { closeDbForTests, ensureInitialized, query } from "../src/lib/db/client";
import { DoseClusteringService } from "../src/lib/services/dose-clustering.service";
import { ClinicalEventsService } from "../src/lib/services/clinical-events.service";
import { FollowUpTopicsService } from "../src/lib/services/follow-up-topics.service";
import { FinancialPlannerService } from "../src/lib/services/financial-planner.service";
import { PatientDossierService } from "../src/lib/services/patient-dossier.service";
import {
  PATIENT_PERSISTENT_KEYBOARD,
  TelegramNotificationService,
} from "../src/lib/services/telegram-notification.service";
import { getCommandCenterSnapshot } from "../src/lib/services/command-center.service";
import {
  GET as cronDispatchGet,
  POST as cronDispatchPost,
} from "../src/app/api/cron/dispatch/route";
import type { ClinicalEventItem, FinancialSettings, Medication } from "../src/lib/types/clinical";

function scanForEmojis(dir: string): string[] {
  const hits: string[] = [];
  const emojiRegex = /[\p{Extended_Pictographic}\uFE0F]/u;

  function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(fullPath);
      } else if (/\.(ts|tsx|css|sql|md)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (emojiRegex.test(line)) {
            hits.push(`${fullPath}:${idx + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }

  walk(dir);
  return hits;
}

async function runVerification() {
  console.log("[1/12] Inicializando esquema DDL (14 tablas), triggers y semilla real...");
  await ensureInitialized();

  const tablesRes = await query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const tableNames = new Set(tablesRes.rows.map((r) => r.tablename));
  for (const expected of [
    "medications",
    "intake_clusters",
    "medication_schedules",
    "intake_logs",
    "clinical_events",
    "follow_up_topics",
    "topic_annotations",
    "telegram_recipients",
    "notification_queue",
    "financial_settings",
    "medical_expenses",
    "patient_profile",
    "care_providers",
    "governance_audit_logs",
  ]) {
    assert.ok(tableNames.has(expected), `Falta tabla ${expected}`);
  }

  const idxRes = await query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
  );
  const idxNames = new Set(idxRes.rows.map((r) => r.indexname));
  for (const idx of [
    "idx_meds_low_stock",
    "idx_intake_pending_today",
    "idx_events_upcoming",
    "idx_topics_open",
    "idx_notifications_dispatch",
    "idx_telegram_active_recipients",
    "idx_expenses_active_date",
    "idx_audit_recent",
  ]) {
    assert.ok(idxNames.has(idx), `Falta indice parcial ${idx}`);
  }

  // 2. Verificar semilla real del Word
  console.log("[2/12] Verificando catalogo real sembrado (7 medicamentos, Rolet pendiente, Fluanxol)...");
  const initialSnap = await getCommandCenterSnapshot();
  assert.equal(initialSnap.medications.length, 7, "Deben sembrarse 7 medicamentos reales");
  const roletMed = initialSnap.medications.find((m) => m.name.includes("Rolet Sup"));
  assert.ok(roletMed, "Debe existir Rolet Sup 80/12.5");
  assert.equal(roletMed.current_stock, null, "Rolet Sup debe iniciar con current_stock NULL");
  assert.equal(roletMed.package_price, null, "Rolet Sup debe iniciar con package_price NULL");
  assert.equal(roletMed.units_per_package, null, "Rolet Sup debe iniciar con units_per_package NULL");
  assert.equal(roletMed.days_of_supply_remaining, null, "Rolet Sup debe tener cobertura NULL");

  const fluanxolMed = initialSnap.medications.find((m) => m.name.includes("Fluanxol"));
  assert.ok(fluanxolMed && fluanxolMed.units_per_package === 1, "Fluanxol debe tener units_per_package = 1");
  const quetiapinaMed = initialSnap.medications.find((m) => m.name.includes("Quetiapina"));
  assert.ok(quetiapinaMed && quetiapinaMed.daily_consumption_rate === 6, "Quetiapina debe tener tasa 6/dia");

  // 3. Calculo de tasa diaria y agrupacion simetrica
  console.log("[3/12] Verificando DoseClusteringService (tasa diaria y shift simetrico)...");
  assert.equal(
    DoseClusteringService.calculateDailyConsumptionRate(1, "FIXED_HOURS", 8),
    3
  );
  assert.equal(
    DoseClusteringService.calculateDailyConsumptionRate(1, "INTERVAL_WEEKS", 3),
    0.0476
  );

  const med8h = await DoseClusteringService.createOrUpdateMedication({
    name: "Test Enalapril 10mg",
    active_ingredient: "Enalapril",
    presentation: "Tableta",
    dose_amount: 1,
    current_stock: 30,
    units_per_package: 30,
    package_price: 120,
    frequency_type: "FIXED_HOURS",
    frequency_value: 8,
    tolerance_window_mins: 30,
    intake_rule: "NONE",
    ideal_times: ["07:30"],
  });

  const medSchedules = await query<{ effective_clustered_time: string; cluster_id: string | null }>(
    `SELECT effective_clustered_time::text, cluster_id FROM medication_schedules
     WHERE medication_id = $1::uuid AND is_active = TRUE ORDER BY effective_clustered_time ASC`,
    [med8h.id]
  );
  assert.ok(medSchedules.rows.length === 3, "Debe generar 3 tomas para cada 8h");
  assert.ok(
    medSchedules.rows.some((s) => s.effective_clustered_time.startsWith("08:00")),
    "El desplazamiento simetrico debe alinear 07:30 -> 08:00"
  );

  // 4. Gobernanza CRUD completa de medicamentos (crear diferido, editar, ajustar, archivar, restaurar, borrar) + clusters CRUD
  console.log("[4/12] Verificando Gobernanza CRUD de Medicamentos y Clusters...");
  const medDeferred = await DoseClusteringService.createOrUpdateMedication({
    name: "Test Diferido Med",
    presentation: "Tableta",
    dose_amount: 1,
    current_stock: null,
    units_per_package: null,
    package_price: null,
    frequency_type: "DAILY_SLOTS",
    frequency_value: 1,
    tolerance_window_mins: 30,
    intake_rule: "WITH_FOOD",
    ideal_times: ["08:00"],
  });
  assert.equal(medDeferred.current_stock, null);

  const medEdited = await DoseClusteringService.createOrUpdateMedication({
    id: medDeferred.id,
    name: "Test Diferido Editado",
    presentation: "Capsula",
    dose_amount: 2,
    current_stock: 20,
    units_per_package: 20,
    package_price: 400,
    frequency_type: "DAILY_SLOTS",
    frequency_value: 1,
    tolerance_window_mins: 30,
    intake_rule: "WITH_FOOD",
    ideal_times: ["08:00"],
  });
  assert.equal(medEdited.name, "Test Diferido Editado");
  assert.equal(medEdited.current_stock, 20);

  const adjusted = await DoseClusteringService.adjustMedicationStock(
    medEdited.id,
    18,
    "Conteo de verificacion"
  );
  assert.equal(adjusted.current_stock, 18);

  const archived = await DoseClusteringService.archiveMedication(
    medEdited.id,
    "Prueba de archivo"
  );
  assert.equal(archived.is_active, false);

  const restored = await DoseClusteringService.restoreMedication(medEdited.id);
  assert.equal(restored.is_active, true);

  await DoseClusteringService.deleteMedicationPermanently(medEdited.id);
  const goneCheck = await query<{ id: string }>(
    `SELECT id FROM medications WHERE id = $1::uuid`,
    [medEdited.id]
  );
  assert.equal(goneCheck.rows.length, 0, "Debe eliminar permanentemente el medicamento");

  const tempCluster = await DoseClusteringService.createCluster({
    label: "Bloque Merienda Test",
    anchor_time: "18:30",
    intake_rule: "NONE",
  });
  const updCluster = await DoseClusteringService.updateCluster(tempCluster.id, {
    label: "Bloque Merienda Editado",
    anchor_time: "18:45",
    intake_rule: "WITH_FOOD",
    is_active: true,
  });
  assert.equal(updCluster.label, "Bloque Merienda Editado");
  await DoseClusteringService.deleteCluster(tempCluster.id);

  // 5. Trigger atomico de descuento + reembolso al revertir/eliminar + no corrupcion de NULL
  console.log("[5/12] Verificando trigger de descuento, alerta <= 7d y reembolso al revertir/borrar...");
  const medLowTrigger = await DoseClusteringService.createOrUpdateMedication({
    name: "Test Prednisona 5mg",
    active_ingredient: "Prednisona",
    presentation: "Tableta",
    dose_amount: 1,
    current_stock: 8,
    units_per_package: 30,
    package_price: 90,
    frequency_type: "DAILY_SLOTS",
    frequency_value: 1,
    tolerance_window_mins: 30,
    intake_rule: "WITH_FOOD",
    ideal_times: ["08:00"],
  });

  const insLogRes = await query<{ id: string }>(
    `INSERT INTO intake_logs (medication_id, scheduled_for, status, quantity_deducted, recorded_by)
     VALUES ($1::uuid, NOW(), 'TAKEN', 1, 'verify-script') RETURNING id`,
    [medLowTrigger.id]
  );
  const takenLogId = insLogRes.rows[0].id;

  let afterMed = await query<{ current_stock: number; days_of_supply_remaining: number }>(
    `SELECT current_stock::float8, days_of_supply_remaining::float8 FROM medications WHERE id = $1::uuid`,
    [medLowTrigger.id]
  );
  assert.equal(afterMed.rows[0].current_stock, 7);
  assert.equal(afterMed.rows[0].days_of_supply_remaining, 7);

  const restockNotif = await query<{ source_type: string; stage: string }>(
    `SELECT source_type, stage FROM notification_queue
     WHERE source_type = 'RESTOCK_ALERT' AND source_id = $1::uuid`,
    [medLowTrigger.id]
  );
  assert.equal(restockNotif.rows.length, 1, "Debe insertar RESTOCK_ALERT al llegar a <= 7d");

  // Revertir TAKEN -> PENDING debe reembolsar +1
  await DoseClusteringService.confirmSingleIntakeLog(takenLogId, "PENDING", "verify-script");
  afterMed = await query<{ current_stock: number; days_of_supply_remaining: number }>(
    `SELECT current_stock::float8, days_of_supply_remaining::float8 FROM medications WHERE id = $1::uuid`,
    [medLowTrigger.id]
  );
  assert.equal(afterMed.rows[0].current_stock, 8, "Revertir TAKEN -> PENDING debe reembolsar stock");

  // Marcar TAKEN y luego eliminar el log debe descontar y volver a reembolsar
  await DoseClusteringService.confirmSingleIntakeLog(takenLogId, "TAKEN", "verify-script");
  await DoseClusteringService.deleteIntakeLog(takenLogId, "verify-script");
  afterMed = await query<{ current_stock: number; days_of_supply_remaining: number }>(
    `SELECT current_stock::float8, days_of_supply_remaining::float8 FROM medications WHERE id = $1::uuid`,
    [medLowTrigger.id]
  );
  assert.equal(afterMed.rows[0].current_stock, 8, "Eliminar log TAKEN debe reembolsar stock");

  // Confirmar toma de Rolet Sup (stock NULL) no debe mutar NULL a 0
  await query(
    `INSERT INTO intake_logs (medication_id, scheduled_for, status, quantity_deducted, recorded_by)
     VALUES ($1::uuid, NOW(), 'TAKEN', 1, 'verify-script')`,
    [roletMed.id]
  );
  const roletAfter = await query<{ current_stock: number | null }>(
    `SELECT current_stock::float8 FROM medications WHERE id = $1::uuid`,
    [roletMed.id]
  );
  assert.equal(roletAfter.rows[0].current_stock, null, "Stock NULL no debe corromperse a 0");

  // 6. Eventos clinicos CRUD completo (crear, editar, completar + gasto, reabrir, eliminar)
  console.log("[6/12] Verificando ClinicalEventsService CRUD completo...");
  const recEvent = await ClinicalEventsService.createClinicalEvent({
    title: "Test Inyeccion Biologica 21d",
    category: "INJECTION",
    specialist_or_center: "Centro Clinico",
    event_datetime: new Date(Date.now() + 10 * 86400000).toISOString(),
    is_recurring: true,
    recurrence_interval_days: 21,
    medication_id: medLowTrigger.id,
    estimated_cost: 500,
    periodicity_label: "Cada 21 dias",
    date_is_estimated: true,
    preparation_instructions: "Aplicacion subcutanea.",
  });

  const updEvent = await ClinicalEventsService.updateClinicalEvent(recEvent.id, {
    title: "Test Inyeccion Editada",
    category: "INJECTION",
    specialist_or_center: "Centro Editado",
    event_datetime: new Date(Date.now() + 12 * 86400000).toISOString(),
    is_recurring: true,
    recurrence_interval_days: 21,
    medication_id: medLowTrigger.id,
    estimated_cost: 650,
    periodicity_label: "Cada 21 dias",
    date_is_estimated: false,
    preparation_instructions: "Aplicacion intramuscular.",
  });
  assert.equal(updEvent.title, "Test Inyeccion Editada");

  const compRes = await ClinicalEventsService.completeClinicalEvent(
    recEvent.id,
    "verify-script",
    { actual_cost: 650, notes: "Aplicada sin incidentes", log_expense: true }
  );
  assert.ok(compRes.nextEventId, "Debe crear automaticamente el siguiente ciclo");
  assert.equal(compRes.stockDeducted, true);
  assert.equal(compRes.expenseLogged, true);

  await ClinicalEventsService.reopenClinicalEvent(recEvent.id);
  await ClinicalEventsService.deleteClinicalEvent(recEvent.id);
  if (compRes.nextEventId) {
    await ClinicalEventsService.deleteClinicalEvent(compRes.nextEventId);
  }

  // 7. Temas de seguimiento + anotaciones CRUD + convertir a evento
  console.log("[7/12] Verificando FollowUpTopicsService CRUD completo y conversion...");
  const topic = await FollowUpTopicsService.createFollowUpTopic({
    title: "Test Buscar Rehabilitador",
    description: "Evaluar 3 opciones",
    priority: 1,
    deadline_at: new Date(Date.now() + 10 * 86400000).toISOString(),
    estimated_budget: 950,
  });
  const ann = await FollowUpTopicsService.addTopicAnnotation({
    topic_id: topic.id,
    author: "Cuidador",
    note_type: "QUOTE",
    contact_name: "Clinica Norte",
    contact_phone: "+52 55 1234 5678",
    estimated_cost: 950,
    content: "Cotizacion inicial.",
  });
  const annUpd = await FollowUpTopicsService.updateTopicAnnotation(ann.id, {
    note_type: "QUOTE",
    estimated_cost: 900,
    content: "Cotizacion ajustada a $900.",
  });
  assert.equal(annUpd.estimated_cost, 900);

  const conv = await FollowUpTopicsService.convertTopicToEvent(
    topic.id,
    {
      title: "Primera Sesion Rehabilitacion",
      category: "APPOINTMENT",
      event_datetime: new Date(Date.now() + 5 * 86400000).toISOString(),
      is_recurring: false,
      estimated_cost: 900,
    },
    true
  );
  assert.equal(conv.topic.status, "COMPLETED");
  await ClinicalEventsService.deleteClinicalEvent(conv.event.id);
  await FollowUpTopicsService.deleteTopicAnnotation(ann.id);
  await FollowUpTopicsService.deleteFollowUpTopic(topic.id);

  // 8. Modulo Financiero y Optimizador Quincenal
  console.log("[8/12] Verificando FinancialPlannerService (quincenas 15/30, feb, suavizado Min-Max, compras y gastos CRUD)...");
  const testSettings: FinancialSettings = {
    id: 1,
    currency: "MXN",
    pay_schedule_type: "QUINCENAL_15_30",
    payday_1: 15,
    payday_2: 30,
    biweekly_anchor_date: null,
    quincenal_budget_cap: 2500,
    monthly_budget_cap: null,
    safety_buffer_days: 7,
    planning_horizon_quincenas: 6,
    include_events_in_plan: true,
    updated_at: new Date().toISOString(),
  };

  // Verificar febrero: debe resolver a 2027-02-28
  const febPlan = FinancialPlannerService.buildFinancialSnapshot(
    [],
    [],
    testSettings,
    [],
    new Date("2027-02-01T12:00:00Z")
  );
  assert.ok(
    febPlan.buckets.some((b) => b.pay_date === "2027-02-28"),
    "El dia 30 en febrero 2027 debe ajustarse al ultimo dia del mes (2027-02-28)"
  );

  // Verificar suavizado de pico: una consulta de $2,000 en Q2 + medicamento caro que cae tambien en Q2 debe adelantarse a Q1
  const spikeMed: Medication = {
    id: "00000000-0000-0000-0000-0000000000a1",
    name: "Med Costoso",
    active_ingredient: "Test",
    presentation: "Caja",
    units_per_package: 30,
    package_price: 1500,
    dose_amount: 1,
    current_stock: 40, // agota ~40 dias -> deadline ~33 dias (caeria en Q2/Q3)
    frequency_type: "DAILY_SLOTS",
    frequency_value: 1,
    tolerance_window_mins: 30,
    intake_rule: "NONE",
    daily_consumption_rate: 1,
    days_of_supply_remaining: 40,
    preferred_pharmacy: null,
    purchase_priority: 1,
    safety_buffer_days: 7,
    clinical_notes: null,
    is_active: true,
    archived_at: null,
    discontinuation_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const spikeEvent: ClinicalEventItem = {
    id: "00000000-0000-0000-0000-0000000000e1",
    title: "Consulta Especialista Cara",
    category: "APPOINTMENT",
    specialist_or_center: "Centro",
    location_address: null,
    event_datetime: "2026-12-31T16:00:00Z", // cae en bucket Q2 (2026-12-30..2027-01-14)
    is_recurring: false,
    recurrence_interval_days: null,
    medication_id: null,
    medication_name: null,
    parent_event_id: null,
    preparation_instructions: null,
    estimated_cost: 2200,
    actual_cost: null,
    periodicity_label: null,
    date_is_estimated: false,
    notes: null,
    is_completed: false,
    completed_at: null,
    created_at: new Date().toISOString(),
    cascade_alerts: [],
  };

  const smoothPlan = FinancialPlannerService.buildFinancialSnapshot(
    [spikeMed],
    [spikeEvent],
    testSettings,
    [],
    new Date("2026-12-01T12:00:00Z")
  );
  assert.ok(
    smoothPlan.summary.optimized_peak_quincena <
      smoothPlan.summary.baseline_peak_quincena,
    "El optimizador debe reducir el pico quincenal respecto al baseline"
  );
  assert.ok(smoothPlan.summary.shifted_purchases_count >= 1);

  const updatedSettings = await FinancialPlannerService.updateFinancialSettings({
    currency: "MXN",
    pay_schedule_type: "QUINCENAL_15_30",
    payday_1: 15,
    payday_2: 30,
    quincenal_budget_cap: 3000,
    monthly_budget_cap: 6000,
    safety_buffer_days: 7,
    planning_horizon_quincenas: 6,
    include_events_in_plan: true,
  });
  assert.equal(updatedSettings.quincenal_budget_cap, 3000);

  const execPurchase = await FinancialPlannerService.executePlannedPurchase({
    medication_id: roletMed.id,
    packages: 1,
    units_override: 30,
    package_price: 420,
    total_amount: 420,
    purchase_date: new Date().toISOString().slice(0, 10),
    quincena_label: "Q2 Nov 2026",
    provider_or_pharmacy: "Farmacia del Ahorro",
    payment_method: "Debito",
  });
  assert.equal(execPurchase.medication.current_stock, 30);
  assert.equal(execPurchase.medication.package_price, 420);

  const updExp = await FinancialPlannerService.updateExpense(execPurchase.expense.id, {
    title: "Compra Rolet Sup Editada",
    category: "MEDICATION",
    status: "PAID",
    amount: 430,
    expense_date: new Date().toISOString().slice(0, 10),
    medication_id: roletMed.id,
  });
  assert.equal(updExp.amount, 430);
  await FinancialPlannerService.deleteExpense(updExp.id);

  // 9. Expediente Clinico y Directorio Medico
  console.log("[9/12] Verificando PatientDossierService y Auditoria...");
  const prof = await PatientDossierService.updatePatientProfile({
    full_name: "Papa Dobrusin",
    blood_type: "O+",
    weight_kg: 76.5,
    allergies: "Ninguna conocida",
  });
  assert.equal(prof.blood_type, "O+");

  const prov = await PatientDossierService.createCareProvider({
    name: "Dr. Prueba",
    specialty: "Medicina Interna",
    consultation_fee: 1100,
  });
  const provUpd = await PatientDossierService.updateCareProvider(prov.id, {
    name: "Dr. Prueba Editado",
    specialty: "Medicina Interna",
    consultation_fee: 1200,
  });
  assert.equal(provUpd.consultation_fee, 1200);
  await PatientDossierService.deleteCareProvider(prov.id);

  // 10. Telegram bilateral + gobernanza de destinatarios y cola
  console.log("[10/12] Verificando TelegramNotificationService (bilateral, NULL-resilient, gobernanza)...");
  const payloadsRes = await query<{ callback_action_payload: string | null }>(
    `SELECT callback_action_payload FROM notification_queue WHERE callback_action_payload IS NOT NULL`
  );
  for (const row of payloadsRes.rows) {
    assert.ok(
      Buffer.byteLength(row.callback_action_payload ?? "", "utf8") <= 64,
      `Payload excede 64 bytes: ${row.callback_action_payload}`
    );
  }

  const dispatchRes = await TelegramNotificationService.dispatchQueuedNotifications();
  assert.ok(dispatchRes.dispatched >= 1);

  const badSecret = await TelegramNotificationService.handleWebhookUpdate(
    { update_id: 1, message: { message_id: 1, chat: { id: 100100002 }, text: "/estado" } },
    "wrong-secret"
  );
  assert.equal(badSecret.unauthorized, true);

  const estadoRes = await TelegramNotificationService.handleWebhookUpdate(
    { update_id: 2, message: { message_id: 2, chat: { id: 100100002 }, text: "/estado" } },
    "verify-secret-token"
  );
  assert.equal(estadoRes.ok, true);
  assert.ok(estadoRes.statusHtml?.includes("ESTADO CLINICO CONSOLIDADO"));
  assert.ok(estadoRes.statusHtml?.includes("1. BLOQUES PENDIENTES HOY"));
  assert.ok(estadoRes.statusHtml?.includes("2. INVENTARIO CRITICO"));
  assert.ok(estadoRes.statusHtml?.includes("3. PROXIMOS EVENTOS CLINICOS"));
  assert.ok(estadoRes.statusHtml?.includes("4. TEMAS DE SEGUIMIENTO ABIERTOS"));

  assert.equal(PATIENT_PERSISTENT_KEYBOARD.is_persistent, true);
  for (const [btnText, expectedAction] of [
    ["[ Tomas de Hoy ]", "tomas_hoy"],
    ["[ Registrar Restock ]", "restock_menu"],
    ["[ Proximas Citas ]", "citas"],
    ["[ Estado de Inventario ]", "estado"],
  ] as const) {
    const btnResp = await TelegramNotificationService.handleWebhookUpdate(
      {
        update_id: Date.now(),
        message: { message_id: 100, chat: { id: 100100002 }, text: btnText },
      },
      "verify-secret-token"
    );
    assert.equal(btnResp.ok, true);
    assert.equal(btnResp.action, expectedAction);
  }

  const restockKb = TelegramNotificationService.buildRestockInlineKeyboard(
    medLowTrigger.id,
    30
  );
  for (const row of restockKb.inline_keyboard) {
    for (const btn of row) {
      assert.ok(Buffer.byteLength(btn.callback_data, "utf8") <= 64);
    }
  }

  const addResp = await TelegramNotificationService.handleWebhookUpdate(
    {
      update_id: Date.now(),
      callback_query: {
        id: "sim_add_1",
        from: { id: 100100002 },
        message: { message_id: 201, chat: { id: 100100002 }, text: "Select" },
        data: `restock_add:${medLowTrigger.id}:30`,
      },
    },
    "verify-secret-token"
  );
  assert.equal(addResp.action, "restock_add");
  assert.ok(addResp.statusHtml?.includes("RESTOCK CONFIRMADO +30"));

  const tempRec = await TelegramNotificationService.upsertRecipient({
    full_name: "Temporal TG",
    role: "FAMILY_MEMBER",
    telegram_chat_id: "999888777",
  });
  const updRec = await TelegramNotificationService.updateRecipient(tempRec.id, {
    full_name: "Temporal Editado",
    role: "CAREGIVER",
    telegram_chat_id: "999888777",
  });
  assert.equal(updRec.full_name, "Temporal Editado");
  await TelegramNotificationService.deleteRecipient(tempRec.id);

  // Confirmacion parcial ack_log + sync Web->TG
  const snapshotBeforeAck = await getCommandCenterSnapshot();
  const pendingCluster = snapshotBeforeAck.today_clusters.find(
    (c) => c.items.filter((i) => i.status === "PENDING").length >= 2
  );
  assert.ok(pendingCluster, "Debe haber un bloque con >= 2 medicinas pendientes");
  const pendingItems = pendingCluster.items.filter((i) => i.status === "PENDING");
  const partialResp = await TelegramNotificationService.handleWebhookUpdate(
    {
      update_id: Date.now(),
      callback_query: {
        id: "sim_ack_log_1",
        from: { id: 100100002 },
        message: { message_id: 202, chat: { id: 100100002 }, text: "Bloque" },
        data: `ack_log:${pendingItems[0].intake_log_id}`,
      },
    },
    "verify-secret-token"
  );
  assert.equal(partialResp.action, "ack_log_partial");

  await DoseClusteringService.confirmClusterIntake(
    pendingCluster.cluster_id,
    snapshotBeforeAck.target_date,
    "Consola Clinica Web",
    { origin: "WEB" }
  );

  // 11. Command Center Snapshot + Vercel Hobby + Cron Auth
  console.log("[11/12] Verificando Command Center Snapshot completo, Vercel Hobby y Cron Auth...");
  const finalSnap = await getCommandCenterSnapshot();
  assert.ok(finalSnap.today_clusters.length >= 1);
  assert.ok(finalSnap.financial_plan.buckets.length >= 6);
  assert.ok(finalSnap.recent_audit_logs.length >= 5);
  assert.equal(finalSnap.patient_profile.blood_type, "O+");

  const vercelRaw = fs.readFileSync(
    path.resolve(process.cwd(), "vercel.json"),
    "utf8"
  );
  const vercelCfg = JSON.parse(vercelRaw) as {
    regions?: string[];
    crons?: unknown;
  };
  assert.deepEqual(vercelCfg.regions, ["iad1"]);
  assert.equal(vercelCfg.crons, undefined);

  const unauthResp = await cronDispatchGet(
    new Request("http://localhost/api/cron/dispatch", { method: "GET" })
  );
  assert.equal(unauthResp.status, 401);

  const wrongAuthResp = await cronDispatchPost(
    new Request("http://localhost/api/cron/dispatch", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-cron-secret" },
    })
  );
  assert.equal(wrongAuthResp.status, 401);

  const okCronResp = await cronDispatchGet(
    new Request("http://localhost/api/cron/dispatch", {
      method: "GET",
      headers: { Authorization: "Bearer verify-cron-secret" },
    })
  );
  assert.equal(okCronResp.status, 200);
  const okCronBody = (await okCronResp.json()) as {
    ok: boolean;
    dispatched_count: number;
  };
  assert.equal(okCronBody.ok, true);

  // 12. Cero emojis estricto en src/
  console.log("[12/12] Auditando cero emojis en todo src/ ...");
  const emojiHits = scanForEmojis(path.resolve(process.cwd(), "src"));
  assert.equal(
    emojiHits.length,
    0,
    `Se encontraron emojis prohibidos en:\n${emojiHits.join("\n")}`
  );

  await closeDbForTests();
  fs.rmSync(testPgDir, { recursive: true, force: true });
  console.log("VERIFICACION INTEGRAL EXITOSA: 12/12 PRUEBAS SUPERADAS CON CERO EMOJIS.");
}

runVerification().catch(async (err) => {
  console.error("VERIFICACION FALLIDA:", err);
  await closeDbForTests().catch(() => {});
  process.exit(1);
});
