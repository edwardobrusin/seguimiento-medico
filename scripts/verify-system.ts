process.env.FORCE_PGLITE = "1";

import { query, withTransaction } from "../src/lib/db/client";
import { seedClinicalDatabaseIfEmpty } from "../src/lib/db/seed";
import { createSessionToken, verifySessionToken } from "../src/lib/auth/session";
import {
  calculateEffectiveDailyRate,
  formatActiveDaysLabel,
  isDateActiveForMedication,
} from "../src/lib/periodicity";
import { AuthService } from "../src/lib/services/auth.service";
import { getCommandCenterSnapshot } from "../src/lib/services/command-center.service";
import { DoseClusteringService } from "../src/lib/services/dose-clustering.service";
import { FinancialPlannerService } from "../src/lib/services/financial-planner.service";
import { FollowUpTopicsService } from "../src/lib/services/follow-up-topics.service";
import { MedicationVersionService } from "../src/lib/services/medication-version.service";
import { PatientDossierService } from "../src/lib/services/patient-dossier.service";
import { TelegramNotificationService } from "../src/lib/services/telegram-notification.service";
import type { Medication } from "../src/lib/types/clinical";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runVerification() {
  console.log("=== VERIFICACION INTEGRAL DEL SISTEMA CLINICO (PGLITE) ===");

  // Reinicio limpio de tablas en PGlite para garantizar semilla actualizada
  await withTransaction(async (tx) => {
    await tx.query(
      `TRUNCATE TABLE
         medication_versions,
         governance_audit_logs,
         medical_expenses,
         notification_queue,
         topic_annotations,
         follow_up_topics,
         clinical_events,
         intake_logs,
         medication_schedules,
         medications,
         intake_clusters,
         financial_settings,
         patient_profile,
         care_providers,
         alert_monitoring_settings,
         auth_users,
         telegram_recipients
       RESTART IDENTITY CASCADE`
    );
    await seedClinicalDatabaseIfEmpty(tx);
  });

  // T1: Seed inicial y estructura base
  console.log("\n[T1] Verificando seed clinico inicial...");
  const adminSnap = await getCommandCenterSnapshot("2026-11-19", "ADMIN");
  assert(
    adminSnap.medications.length === 7,
    `Esperaba 7 medicamentos iniciales, obtuvo ${adminSnap.medications.length}`
  );
  assert(
    adminSnap.clusters.filter((c) => c.is_active).length === 3,
    `Esperaba 3 bloques horarios activos (08:00, 15:00, 21:00), obtuvo ${adminSnap.clusters.length}`
  );
  const rolet = adminSnap.medications.find((m) =>
    m.name.toLowerCase().includes("rolet")
  );
  assert(rolet, "Rolet Sup debe existir en el catalogo");
  assert(
    rolet.current_stock === null && rolet.package_price === null,
    "Rolet Sup debe iniciar con stock y precio diferibles (null)"
  );
  console.log(
    "  OK: 7 medicamentos reales, 3 bloques activos (08:00/15:00/21:00) y campos diferibles."
  );

  // T2: Datos clinicos reales solicitados (Valproato 08/15/21h, Leflunomida Lu-Vi, Fluanxol 27-nov-2026 oficial)
  console.log(
    "\n[T2] Verificando esquema real de Valproato, Leflunomida y Fluanxol..."
  );
  const valproato = adminSnap.medications.find((m) =>
    m.name.toLowerCase().includes("valproato")
  );
  assert(valproato, "Valproato semisodico 500 mg debe existir");
  assert(
    valproato.frequency_type === "DAILY_SLOTS" &&
      valproato.frequency_value === 3,
    `Valproato debe ser DAILY_SLOTS=3, obtuvo ${valproato.frequency_type}=${valproato.frequency_value}`
  );
  assert(
    Number(valproato.daily_consumption_rate) === 3,
    `Valproato debe tener tasa diaria 3, obtuvo ${valproato.daily_consumption_rate}`
  );
  const valTimes = (valproato.schedules ?? []).map((s) =>
    s.effective_clustered_time.slice(0, 5)
  );
  assert(
    valTimes.includes("08:00") &&
      valTimes.includes("15:00") &&
      valTimes.includes("21:00"),
    `Valproato debe estar en bloques 08:00, 15:00 y 21:00; obtuvo ${valTimes.join(", ")}`
  );

  const leflu = adminSnap.medications.find((m) =>
    m.name.toLowerCase().includes("leflunomida")
  );
  assert(leflu, "Leflunomida 20 mg debe existir");
  assert(
    formatActiveDaysLabel(leflu.active_days) === "Lunes a Viernes",
    `Leflunomida debe tener dias Lunes a Viernes, obtuvo ${formatActiveDaysLabel(leflu.active_days)}`
  );
  assert(
    Math.abs(Number(leflu.daily_consumption_rate) - 0.7143) < 0.001,
    `Leflunomida debe tener tasa efectiva 0.7143/dia, obtuvo ${leflu.daily_consumption_rate}`
  );
  assert(
    Math.abs(Number(leflu.days_of_supply_remaining) - 126) < 0.5,
    `Leflunomida con 90 tabletas Lu-Vi debe durar 126 dias, obtuvo ${leflu.days_of_supply_remaining}`
  );

  const fluanxolEvent = adminSnap.upcoming_events.find((e) =>
    e.title.toLowerCase().includes("fluanxol")
  );
  assert(fluanxolEvent, "Evento de Inyeccion Fluanxol 20 mg debe existir");
  assert(
    fluanxolEvent.event_datetime.startsWith("2026-11-27"),
    `Inyeccion Fluanxol debe tener fecha 2026-11-27, obtuvo ${fluanxolEvent.event_datetime}`
  );
  assert(
    fluanxolEvent.date_is_estimated === false,
    "Inyeccion Fluanxol debe estar marcada como fecha oficial (date_is_estimated = false)"
  );
  assert(
    fluanxolEvent.cascade_alerts.length === 4,
    `Inyeccion Fluanxol debe tener 4 alertas en cascada (-7d, -3d, -1d, 0d), obtuvo ${fluanxolEvent.cascade_alerts.length}`
  );
  console.log(
    "  OK: Valproato (08/15/21h), Leflunomida (Lu-Vi, 0.7143/d, 126d) y Fluanxol (2026-11-27 Oficial)."
  );

  // T3: Periodicidad por dia de la semana en generacion de tomas
  console.log(
    "\n[T3] Verificando generacion de tomas de Lunes a Viernes vs Sabado/Domingo..."
  );
  assert(
    isDateActiveForMedication(leflu, "2026-11-19") === true,
    "Jueves 2026-11-19 debe ser dia activo para Leflunomida"
  );
  assert(
    isDateActiveForMedication(leflu, "2026-11-21") === false,
    "Sabado 2026-11-21 debe ser dia de descanso para Leflunomida"
  );
  assert(
    isDateActiveForMedication(leflu, "2026-11-22") === false,
    "Domingo 2026-11-22 debe ser dia de descanso para Leflunomida"
  );

  await DoseClusteringService.generateDailyIntakeLogsAndAlerts("2026-11-19");
  const thuSnap = await getCommandCenterSnapshot("2026-11-19", "PATIENT");
  const thuItems = thuSnap.today_clusters.flatMap((c) => c.items);
  assert(
    thuItems.some((i) => i.medication_id === leflu.id),
    "Leflunomida debe aparecer en las tomas del jueves 2026-11-19"
  );
  assert(
    !thuSnap.resting_medications_today.some((r) => r.medication_id === leflu.id),
    "Leflunomida NO debe aparecer en descanso el jueves"
  );

  await DoseClusteringService.generateDailyIntakeLogsAndAlerts("2026-11-21");
  const satSnap = await getCommandCenterSnapshot("2026-11-21", "PATIENT");
  const satItems = satSnap.today_clusters.flatMap((c) => c.items);
  assert(
    !satItems.some((i) => i.medication_id === leflu.id),
    "Leflunomida NO debe generar toma el sabado 2026-11-21"
  );
  assert(
    satSnap.resting_medications_today.some((r) => r.medication_id === leflu.id),
    "Leflunomida debe aparecer en resting_medications_today el sabado"
  );
  console.log(
    "  OK: Periodicidad Lu-Vi genera toma en jueves y descansa en sabado/domingo."
  );

  // T4: Autenticacion y tokens firmados
  console.log(
    "\n[T4] Verificando autenticacion obligatoria y sesiones HMAC..."
  );
  const adminUser = await AuthService.authenticateUser(
    "admin",
    "AdminClinico2026!"
  );
  assert(adminUser && adminUser.role === "ADMIN", "Login de admin debe ser exitoso");
  const patientUser = await AuthService.authenticateUser("papa", "Salud2026");
  assert(
    patientUser && patientUser.role === "PATIENT",
    "Login de paciente debe ser exitoso"
  );
  const badLogin = await AuthService.authenticateUser("papa", "ClaveIncorrecta");
  assert(badLogin === null, "Contrasena incorrecta debe retornar null");

  const token = createSessionToken({
    id: patientUser.id,
    username: patientUser.username,
    displayName: patientUser.displayName,
    role: patientUser.role,
  });
  const verifiedSession = verifySessionToken(token);
  assert(
    verifiedSession &&
      verifiedSession.username === "papa" &&
      verifiedSession.role === "PATIENT",
    "Token HMAC debe verificarse correctamente"
  );
  console.log("  OK: Autenticacion de Paciente y Administrador verificada.");

  // T5: RBAC Sigiloso (Stealth Patient Mode)
  console.log(
    "\n[T5] Verificando aislamiento sigiloso de snapshot para Paciente..."
  );
  const patientSnap = await getCommandCenterSnapshot("2026-11-19", "PATIENT");
  assert(
    patientSnap.telegram_configured === false &&
      patientSnap.telegram_recipients.length === 0 &&
      patientSnap.recent_notifications.length === 0,
    "Paciente NO debe recibir ningun dato de Telegram en el snapshot"
  );
  assert(
    patientSnap.medication_versions.length === 0 &&
      patientSnap.recent_audit_logs.length === 0 &&
      patientSnap.archived_medications.length === 0 &&
      patientSnap.auth_users.length === 0 &&
      patientSnap.alert_monitoring_settings === null,
    "Paciente NO debe recibir versiones, auditoria, archivados, cuentas ni monitoreo"
  );
  assert(
    patientSnap.today_clusters.every((c) => c.telegram_notification === null),
    "Los bloques del paciente no deben incluir metadatos de notificaciones de Telegram"
  );
  assert(
    adminSnap.telegram_recipients.length >= 3 &&
      adminSnap.auth_users.length === 2 &&
      adminSnap.alert_monitoring_settings !== null,
    "Administrador SI debe recibir destinatarios de Telegram, cuentas y monitoreo"
  );
  console.log(
    "  OK: Snapshot del paciente 100% libre de referencias a Telegram, versiones y admin."
  );

  // T6: Control de Versiones en Medicamentos (Edicion por Paciente -> Alerta Admin -> Restauracion)
  console.log(
    "\n[T6] Verificando control de versiones y restauracion por Administrador..."
  );
  const originalDose = leflu.dose_amount;
  const updatedByPatient = await DoseClusteringService.createOrUpdateMedication(
    {
      id: leflu.id,
      name: leflu.name,
      active_ingredient: leflu.active_ingredient,
      presentation: leflu.presentation,
      units_per_package: leflu.units_per_package,
      package_price: leflu.package_price,
      dose_amount: 2,
      current_stock: leflu.current_stock,
      frequency_type: leflu.frequency_type,
      frequency_value: leflu.frequency_value,
      tolerance_window_mins: leflu.tolerance_window_mins,
      intake_rule: leflu.intake_rule,
      active_days: [1, 3, 5],
      schedule_start_date: null,
      preferred_pharmacy: leflu.preferred_pharmacy,
      purchase_priority: leflu.purchase_priority,
      safety_buffer_days: leflu.safety_buffer_days,
      clinical_notes: "Cambio temporal hecho por paciente",
      ideal_times: ["08:00:00"],
    },
    { role: "PATIENT", actor: "Paciente (Papa)" }
  );
  assert(
    Number(updatedByPatient.dose_amount) === 2,
    "El paciente debe poder editar un medicamento libremente"
  );

  const versions = await MedicationVersionService.listVersionsForMedication(
    leflu.id
  );
  assert(
    versions.length >= 2,
    `Deben existir al menos 2 versiones (base + edicion del paciente), obtuvo ${versions.length}`
  );
  const latestVersion = versions[0];
  const baselineVersion = versions[versions.length - 1];
  assert(
    latestVersion.changed_by_role === "PATIENT" &&
      latestVersion.reviewed_by_admin === false,
    "La version editada por el paciente debe quedar pendiente de revision por admin"
  );
  assert(
    latestVersion.changed_fields.some((f) => f.field === "dose_amount"),
    "El diff de la version debe registrar el cambio de dosis"
  );

  const changeAlertsRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM notification_queue
     WHERE source_type = 'PATIENT_CHANGE_ALERT'
       AND source_id = $1::uuid`,
    [leflu.id]
  );
  assert(
    Number(changeAlertsRes.rows[0]?.count ?? 0) >= 1,
    "Editar como paciente debe encolar una alerta PATIENT_CHANGE_ALERT para administradores"
  );

  await MedicationVersionService.markVersionReviewed(
    latestVersion.id,
    "Administrador Clinico"
  );
  await MedicationVersionService.restoreMedicationVersion(
    leflu.id,
    baselineVersion.id,
    "Administrador Clinico"
  );

  const restoredSnap = await getCommandCenterSnapshot("2026-11-19", "ADMIN");
  const restoredLeflu = restoredSnap.medications.find((m) => m.id === leflu.id);
  assert(
    restoredLeflu &&
      Number(restoredLeflu.dose_amount) === Number(originalDose) &&
      formatActiveDaysLabel(restoredLeflu.active_days) === "Lunes a Viernes",
    "La restauracion de version debe devolver Leflunomida a dosis 1 y Lunes a Viernes"
  );
  console.log(
    "  OK: Version base capturada, cambio del paciente auditado y version restaurada con exito."
  );

  // T7: Trigger SQL de descuento de stock y reversa
  console.log("\n[T7] Verificando trigger SQL fn_process_medication_intake...");
  const thuLog = thuItems.find((i) => i.medication_id === valproato.id);
  assert(thuLog, "Debe existir toma de Valproato el jueves");
  const stockBefore = valproato.current_stock ?? 0;

  await DoseClusteringService.confirmSingleIntakeLog(
    thuLog.intake_log_id,
    "TAKEN",
    "Test Runner",
    "Tomada con desayuno"
  );
  const afterTakenRes = await query<{ current_stock: string }>(
    `SELECT current_stock::text FROM medications WHERE id = $1::uuid`,
    [valproato.id]
  );
  assert(
    Number(afterTakenRes.rows[0]?.current_stock) ===
      stockBefore - valproato.dose_amount,
    "Confirmar TAKEN debe descontar la dosis del stock"
  );

  await DoseClusteringService.confirmSingleIntakeLog(
    thuLog.intake_log_id,
    "PENDING",
    "Test Runner"
  );
  const afterRevertRes = await query<{ current_stock: string }>(
    `SELECT current_stock::text FROM medications WHERE id = $1::uuid`,
    [valproato.id]
  );
  assert(
    Number(afterRevertRes.rows[0]?.current_stock) === stockBefore,
    "Revertir a PENDING debe reembolsar la dosis al stock"
  );
  console.log("  OK: Descuento y reembolso transaccional de stock verificados.");

  // T8: Gobernanza CRUD de medicamentos, eventos, temas, finanzas y expediente
  console.log(
    "\n[T8] Verificando CRUD completo (Medicamentos, Eventos, Temas, Finanzas, Expediente)..."
  );
  const tempMed = await DoseClusteringService.createOrUpdateMedication(
    {
      name: "Test Enalapril 10mg",
      active_ingredient: "Enalapril",
      presentation: "Tabletas",
      units_per_package: 30,
      package_price: 240,
      dose_amount: 1,
      current_stock: 15,
      frequency_type: "DAILY_SLOTS",
      frequency_value: 2,
      tolerance_window_mins: 45,
      intake_rule: "WITH_FOOD",
      active_days: [1, 2, 3, 4, 5],
      schedule_start_date: null,
      preferred_pharmacy: "Farmacia San Pablo",
      purchase_priority: 2,
      safety_buffer_days: 7,
      clinical_notes: "Prueba temporal",
      ideal_times: ["08:00:00", "21:00:00"],
    },
    { role: "ADMIN", actor: "Test Suite" }
  );
  assert(
    Math.abs(
      tempMed.daily_consumption_rate -
        calculateEffectiveDailyRate(1, "DAILY_SLOTS", 2, [1, 2, 3, 4, 5])
    ) < 0.001,
    "Tasa diaria de medicamento Lu-Vi con 2 tomas debe ser 1.4286"
  );
  await DoseClusteringService.archiveMedication(tempMed.id, "Fin de prueba");
  await DoseClusteringService.restoreMedication(tempMed.id);
  await DoseClusteringService.deleteMedicationPermanently(tempMed.id);

  const mockMed: Medication = {
    id: "00000000-0000-0000-0000-000000000099",
    name: "Mock Med",
    active_ingredient: null,
    presentation: "Tabletas",
    units_per_package: 30,
    package_price: 600,
    dose_amount: 1,
    current_stock: 5,
    frequency_type: "DAILY_SLOTS",
    frequency_value: 1,
    tolerance_window_mins: 30,
    intake_rule: "NONE",
    active_days: null,
    schedule_start_date: null,
    daily_consumption_rate: 1,
    days_of_supply_remaining: 5,
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
  const planCheck = FinancialPlannerService.buildFinancialSnapshot(
    [mockMed],
    [],
    null,
    [],
    new Date("2026-11-19T12:00:00Z")
  );
  assert(
    planCheck.buckets.some((b) => b.purchases.length >= 1),
    "Debe proyectar compras quincenales"
  );

  const tempTopic = await FollowUpTopicsService.createFollowUpTopic({
    title: "Cotizar estudio temporal",
    description: "Prueba",
    priority: 2,
    deadline_at: new Date(Date.now() + 5 * 86400000).toISOString(),
    estimated_budget: 1200,
  });
  const tempAnn = await FollowUpTopicsService.addTopicAnnotation({
    topic_id: tempTopic.id,
    author: "Test",
    note_type: "QUOTE",
    content: "Cotizacion recibida",
  });
  await FollowUpTopicsService.deleteTopicAnnotation(tempAnn.id);
  await FollowUpTopicsService.deleteFollowUpTopic(tempTopic.id);

  const tempProvider = await PatientDossierService.createCareProvider({
    name: "Dr. Temporal",
    specialty: "Medicina Interna",
  });
  await PatientDossierService.deleteCareProvider(tempProvider.id);
  console.log("  OK: Gobernanza CRUD y motor financiero quincenal verificados.");

  // T9: Separacion Paciente vs Admin en Telegram + Alertas de Bloque Atrasado + Reporte Semanal
  console.log(
    "\n[T9] Verificando separacion de roles y monitoreo administrativo en Telegram..."
  );
  const patientReportAttempt =
    await TelegramNotificationService.handleWebhookUpdate(
      {
        update_id: 90001,
        message: {
          message_id: 1,
          chat: { id: 100100001 }, // Chat ID del Paciente
          text: "/reporte",
        },
      },
      null,
      { skipSecretCheck: true }
    );
  assert(
    !(patientReportAttempt.statusHtml ?? "").includes("REPORTE SEMANAL"),
    "El paciente en Telegram NO debe tener acceso al comando /reporte de administradores"
  );

  const adminReportAttempt =
    await TelegramNotificationService.handleWebhookUpdate(
      {
        update_id: 90002,
        message: {
          message_id: 2,
          chat: { id: 100100002 }, // Chat ID de Administrador
          text: "/reporte",
        },
      },
      null,
      { skipSecretCheck: true }
    );
  assert(
    (adminReportAttempt.statusHtml ?? "").includes("REPORTE SEMANAL"),
    "El administrador en Telegram SI debe recibir el reporte semanal con /reporte"
  );

  // Restock hecho por paciente en Telegram crea version y alerta para admin
  const patientRestockAttempt =
    await TelegramNotificationService.handleWebhookUpdate(
      {
        update_id: 90003,
        callback_query: {
          id: "sim_cb_restock_test",
          from: { id: 100100001 },
          message: {
            message_id: 3,
            chat: { id: 100100001 },
          },
          data: `restock_add:${valproato.id}:30`,
        },
      },
      null,
      { skipSecretCheck: true }
    );
  assert(
    patientRestockAttempt.ok,
    "El paciente debe poder registrar restock desde Telegram"
  );
  const valVersions = await MedicationVersionService.listVersionsForMedication(
    valproato.id
  );
  assert(
    valVersions.some(
      (v) => v.change_action === "RESTOCK" && v.changed_by_role === "PATIENT"
    ),
    "El restock del paciente en Telegram debe quedar registrado en control de versiones para el admin"
  );

  // Evaluacion de bloque no marcado como tomado (60 min despues de las 08:00 -> 10:30 local)
  const missedEval = await TelegramNotificationService.evaluateMissedBlockAlerts(
    new Date("2026-11-19T16:30:00Z") // 10:30 America/Mexico_City (UTC-6)
  );
  assert(
    missedEval.queued >= 1,
    `Debe encolar alerta MISSED_INTAKE_ALERT para el bloque de las 08:00 no tomado (encoladas: ${missedEval.queued})`
  );

  const weeklyNow = await TelegramNotificationService.queueWeeklyReportNow(
    "Test Runner"
  );
  assert(
    weeklyNow.reportHtml.includes("REPORTE SEMANAL"),
    "queueWeeklyReportNow debe generar el HTML del reporte semanal de comportamiento"
  );
  console.log(
    "  OK: Bot separado por rol, alerta de bloque no tomado y reporte semanal verificados."
  );

  console.log("\n=== TODAS LAS PRUEBAS (T1 - T9) PASARON EXITOSAMENTE ===");
}

runVerification().catch((err) => {
  console.error("\nFALLO EN VERIFICACION:", err);
  process.exit(1);
});
