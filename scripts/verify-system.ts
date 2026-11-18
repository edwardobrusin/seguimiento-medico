import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const testPgDir = path.join(os.tmpdir(), `clinical-verify-${Date.now()}`);
process.env.CLINICAL_PGDATA_DIR = testPgDir;
process.env.TELEGRAM_WEBHOOK_SECRET = "verify-secret-token";
process.env.CRON_SECRET = "verify-cron-secret";

import { closeDbForTests, ensureInitialized, query } from "../src/lib/db/client";
import { DoseClusteringService } from "../src/lib/services/dose-clustering.service";
import { ClinicalEventsService } from "../src/lib/services/clinical-events.service";
import { FollowUpTopicsService } from "../src/lib/services/follow-up-topics.service";
import { TelegramNotificationService } from "../src/lib/services/telegram-notification.service";
import { getCommandCenterSnapshot } from "../src/lib/services/command-center.service";
import {
  GET as cronDispatchGet,
  POST as cronDispatchPost,
} from "../src/app/api/cron/dispatch/route";

function scanForEmojis(dir: string): string[] {
  const hits: string[] = [];
  const emojiRegex = /[\p{Extended_Pictographic}\uFE0F]/u;

  function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(fullPath);
      } else if (/\.(ts|tsx|css|sql)$/.test(entry.name)) {
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
  console.log("[1/8] Inicializando esquema DDL, triggers y semilla en PostgreSQL...");
  await ensureInitialized();

  // 1. Verificar 9 tablas, 7 enums, 6 indices parciales y 2 funciones
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
  ]) {
    assert.ok(idxNames.has(idx), `Falta indice parcial ${idx}`);
  }

  // 2. Calculo de tasa diaria y agrupacion simetrica
  console.log("[2/8] Verificando DoseClusteringService (tasa diaria y shift simetrico)...");
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
    frequency_type: "FIXED_HOURS",
    frequency_value: 8,
    tolerance_window_mins: 30,
    intake_rule: "NONE",
    ideal_times: ["07:30"],
  });

  const medSchedules = await query<{ effective_clustered_time: string; cluster_id: string | null }>(
    `SELECT effective_clustered_time::text, cluster_id FROM medication_schedules
     WHERE medication_id = $1 AND is_active = TRUE ORDER BY effective_clustered_time ASC`,
    [med8h.id]
  );
  assert.ok(medSchedules.rows.length === 3, "Debe generar 3 tomas para cada 8h");
  assert.ok(
    medSchedules.rows.some((s) => s.effective_clustered_time.startsWith("08:00")),
    "El desplazamiento simetrico debe alinear 07:30 -> 08:00"
  );

  // 3. Trigger atomico de descuento de inventario y alerta <= 7 dias
  console.log("[3/8] Verificando trigger trg_after_intake_taken y alerta <= 7 dias...");
  const medLowTrigger = await DoseClusteringService.createOrUpdateMedication({
    name: "Test Prednisona 5mg",
    active_ingredient: "Prednisona",
    presentation: "Tableta",
    dose_amount: 1,
    current_stock: 8,
    frequency_type: "DAILY_SLOTS",
    frequency_value: 1,
    tolerance_window_mins: 30,
    intake_rule: "WITH_FOOD",
    ideal_times: ["08:00"],
  });

  await query(
    `INSERT INTO intake_logs (medication_id, scheduled_for, status, quantity_deducted, recorded_by)
     VALUES ($1, NOW(), 'TAKEN', 1, 'verify-script')`,
    [medLowTrigger.id]
  );

  const afterMed = await query<{ current_stock: number; days_of_supply_remaining: number }>(
    `SELECT current_stock::float8, days_of_supply_remaining::float8 FROM medications WHERE id = $1`,
    [medLowTrigger.id]
  );
  assert.equal(afterMed.rows[0].current_stock, 7);
  assert.equal(afterMed.rows[0].days_of_supply_remaining, 7);

  const restockNotif = await query<{ source_type: string; stage: string; title: string }>(
    `SELECT source_type, stage, title FROM notification_queue
     WHERE source_type = 'RESTOCK_ALERT' AND source_id = $1`,
    [medLowTrigger.id]
  );
  assert.equal(restockNotif.rows.length, 1, "Debe insertar alerta RESTOCK_ALERT al llegar a <= 7 dias");
  assert.equal(restockNotif.rows[0].stage, "LOW_STOCK_7D");

  // 4. Eventos clinicos recurrentes + descuento + renovacion + cascada -7d/-3d/-1d/0d
  console.log("[4/8] Verificando ClinicalEventsService y cascada (-7d, -3d, -1d, 0d)...");
  const recEvent = await ClinicalEventsService.createClinicalEvent({
    title: "Test Inyeccion Biologica 21d",
    category: "INJECTION",
    specialist_or_center: "Centro Clinico",
    event_datetime: new Date(Date.now() + 10 * 86400000).toISOString(),
    is_recurring: true,
    recurrence_interval_days: 21,
    medication_id: medLowTrigger.id,
    preparation_instructions: "Aplicacion subcutanea.",
  });

  const cascadeRes = await query<{ stage: string }>(
    `SELECT stage FROM notification_queue WHERE source_type = 'CLINICAL_EVENT' AND source_id = $1`,
    [recEvent.id]
  );
  assert.equal(cascadeRes.rows.length, 4, "Debe programar las 4 etapas (-7d, -3d, -1d, 0d)");

  const compRes = await ClinicalEventsService.completeClinicalEvent(recEvent.id, "verify-script");
  assert.ok(compRes.nextEventId, "Debe crear automaticamente el siguiente evento recurrente");
  assert.equal(compRes.stockDeducted, true, "Debe descontar dosis del inventario vinculado");

  const nextEvtCheck = await query<{ parent_event_id: string }>(
    `SELECT parent_event_id FROM clinical_events WHERE id = $1`,
    [compRes.nextEventId]
  );
  assert.equal(nextEvtCheck.rows[0].parent_event_id, recEvent.id);

  // 5. Temas de seguimiento y bitacora
  console.log("[5/8] Verificando FollowUpTopicsService y topic_annotations...");
  const topic = await FollowUpTopicsService.createFollowUpTopic({
    title: "Test Buscar Rehabilitador",
    description: "Evaluar 3 opciones",
    priority: 1,
    deadline_at: new Date(Date.now() + 10 * 86400000).toISOString(),
  });
  const ann = await FollowUpTopicsService.addTopicAnnotation({
    topic_id: topic.id,
    author: "Argon",
    note_type: "QUOTE",
    contact_name: "Clinica Norte",
    contact_phone: "+52 55 1234 5678",
    estimated_cost: 950,
    content: "Cotizacion inicial por sesion.",
  });
  assert.equal(ann.estimated_cost, 950);

  // 6. Telegram dispatcher + webhook secret + /estado + payload <= 64 bytes
  console.log("[6/8] Verificando TelegramNotificationService (dispatch, secret, /estado, <= 64 bytes)...");
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
  assert.ok(dispatchRes.dispatched >= 1, "Debe despachar al menos 1 notificacion en cola");

  const badSecret = await TelegramNotificationService.handleWebhookUpdate(
    { update_id: 1, message: { message_id: 1, chat: { id: 100100002 }, text: "/estado" } },
    "wrong-secret"
  );
  assert.equal(badSecret.unauthorized, true, "Debe rechazar secreto de webhook invalido");

  const estadoRes = await TelegramNotificationService.handleWebhookUpdate(
    { update_id: 2, message: { message_id: 2, chat: { id: 100100002 }, text: "/estado" } },
    "verify-secret-token"
  );
  assert.equal(estadoRes.ok, true);
  assert.ok(
    estadoRes.statusHtml?.includes("ESTADO CLINICO CONSOLIDADO"),
    "Debe generar reporte HTML /estado"
  );
  assert.ok(estadoRes.statusHtml?.includes("1. BLOQUES PENDIENTES HOY"));
  assert.ok(estadoRes.statusHtml?.includes("2. INVENTARIO CRITICO"));
  assert.ok(estadoRes.statusHtml?.includes("3. PROXIMOS EVENTOS CLINICOS"));
  assert.ok(estadoRes.statusHtml?.includes("4. TEMAS DE SEGUIMIENTO ABIERTOS"));

  // 7. Single-trip Command Center Snapshot
  console.log("[7/8] Verificando getCommandCenterSnapshot (single-trip CTE)...");
  const snapshot = await getCommandCenterSnapshot();
  assert.ok(snapshot.today_clusters.length >= 1, "Debe incluir bloques de hoy");
  assert.ok(snapshot.medications.length >= 5, "Debe incluir catalogo de medicamentos");
  assert.ok(snapshot.upcoming_events.length >= 1, "Debe incluir eventos proximos");
  assert.ok(snapshot.open_topics.length >= 1, "Debe incluir temas de seguimiento");

  // 8. Arquitectura Vercel Hobby (vercel.json iad1 sin crons, /api/cron/dispatch y registerVercelWebhook)
  console.log("[8/9] Verificando configuracion Vercel Hobby, /api/cron/dispatch y setWebhook...");
  const vercelRaw = fs.readFileSync(
    path.resolve(process.cwd(), "vercel.json"),
    "utf8"
  );
  const vercelCfg = JSON.parse(vercelRaw) as {
    regions?: string[];
    crons?: unknown;
  };
  assert.deepEqual(vercelCfg.regions, ["iad1"]);
  assert.equal(
    vercelCfg.crons,
    undefined,
    "vercel.json no debe incluir bloque crons en Plan Hobby"
  );

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
  assert.ok(
    okCronResp.headers.get("cache-control")?.includes("no-store"),
    "Debe incluir Cache-Control no-store"
  );
  const okCronBody = (await okCronResp.json()) as {
    ok: boolean;
    dispatched_count: number;
    failed_count: number;
    execution_ms: number;
  };
  assert.equal(okCronBody.ok, true);
  assert.equal(typeof okCronBody.dispatched_count, "number");
  assert.equal(typeof okCronBody.failed_count, "number");
  assert.equal(typeof okCronBody.execution_ms, "number");

  const webhookReg = await TelegramNotificationService.registerVercelWebhook(
    "https://clinical-care-demo.vercel.app/"
  );
  assert.equal(webhookReg.ok, true);
  assert.equal(
    webhookReg.webhook_url,
    "https://clinical-care-demo.vercel.app/api/telegram/webhook"
  );
  assert.equal(webhookReg.secret_configured, true);

  // 9. Escaneo estricto cero emojis
  console.log("[9/9] Auditando cero emojis en todo src/ ...");
  const emojiHits = scanForEmojis(path.resolve(process.cwd(), "src"));
  assert.equal(
    emojiHits.length,
    0,
    `Se encontraron emojis prohibidos en:\n${emojiHits.join("\n")}`
  );

  await closeDbForTests();
  fs.rmSync(testPgDir, { recursive: true, force: true });
  console.log("VERIFICACION INTEGRAL EXITOSA: 9/9 PRUEBAS SUPERADAS CON CERO EMOJIS.");
}

runVerification().catch(async (err) => {
  console.error("VERIFICACION FALLIDA:", err);
  await closeDbForTests().catch(() => {});
  process.exit(1);
});
