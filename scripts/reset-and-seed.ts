import fs from "node:fs";
import path from "node:path";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  for (const line of fs.readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}

import {
  closeDbForTests,
  getDbMode,
  getRawExecutor,
  runSchemaAndTriggers,
} from "../src/lib/db/client";
import { seedClinicalDatabaseIfEmpty } from "../src/lib/db/seed";

const PLACEHOLDER_CHAT_IDS = new Set(["100100001", "100100002", "100100003"]);

async function main() {
  const forcePreserveFlag = process.argv.includes("--preserve-telegram");
  const mode = getDbMode();
  console.log("DB_MODE:", mode);

  const db = await getRawExecutor();
  console.log("Aplicando schema.sql y triggers.sql idempotentes...");
  await runSchemaAndTriggers(db);

  // Detectar si existen destinatarios reales distintos a los placeholders
  const recRes = await db.query<{ telegram_chat_id: string }>(
    `SELECT telegram_chat_id FROM telegram_recipients`
  );
  const hasRealRecipients = recRes.rows.some(
    (r) => !PLACEHOLDER_CHAT_IDS.has(r.telegram_chat_id)
  );
  const preserveTelegram = forcePreserveFlag || hasRealRecipients;

  console.log(
    `Limpiando tablas de datos (${preserveTelegram ? "preservando telegram_recipients reales" : "reinicio integral"})...`
  );

  const tablesToTruncate = [
    "governance_audit_logs",
    "medical_expenses",
    "notification_queue",
    "topic_annotations",
    "follow_up_topics",
    "clinical_events",
    "intake_logs",
    "medication_schedules",
    "medications",
    "intake_clusters",
    "financial_settings",
    "patient_profile",
    "care_providers",
  ];
  if (!preserveTelegram) {
    tablesToTruncate.push("telegram_recipients");
  }

  await db.exec(
    `TRUNCATE TABLE ${tablesToTruncate.join(", ")} RESTART IDENTITY CASCADE;`
  );

  console.log("Poblando base clinica con el esquema real del paciente...");
  await seedClinicalDatabaseIfEmpty(db);

  const counts = await Promise.all([
    db.query<{ c: number }>("SELECT count(*)::int AS c FROM intake_clusters"),
    db.query<{ c: number }>("SELECT count(*)::int AS c FROM medications"),
    db.query<{ c: number }>("SELECT count(*)::int AS c FROM clinical_events"),
    db.query<{ c: number }>("SELECT count(*)::int AS c FROM follow_up_topics"),
    db.query<{ c: number }>("SELECT count(*)::int AS c FROM care_providers"),
    db.query<{ c: number }>("SELECT count(*)::int AS c FROM telegram_recipients"),
    db.query<{ c: number }>("SELECT count(*)::int AS c FROM notification_queue"),
  ]);

  console.log("RESUMEN_POBLADO:", {
    intake_clusters: counts[0].rows[0].c,
    medications: counts[1].rows[0].c,
    clinical_events: counts[2].rows[0].c,
    follow_up_topics: counts[3].rows[0].c,
    care_providers: counts[4].rows[0].c,
    telegram_recipients: counts[5].rows[0].c,
    notification_queue: counts[6].rows[0].c,
  });

  const medsList = await db.query<{
    name: string;
    current_stock: number | null;
    units_per_package: number | null;
    package_price: number | null;
    days_of_supply_remaining: number | null;
  }>(
    `SELECT
       name,
       current_stock::float8 AS current_stock,
       units_per_package::float8 AS units_per_package,
       package_price::float8 AS package_price,
       days_of_supply_remaining::float8 AS days_of_supply_remaining
     FROM medications
     ORDER BY name ASC`
  );
  console.table(medsList.rows);

  const eventsList = await db.query<{
    title: string;
    event_datetime: string;
    estimated_cost: number | null;
    periodicity_label: string | null;
  }>(
    `SELECT
       title,
       event_datetime::text AS event_datetime,
       estimated_cost::float8 AS estimated_cost,
       periodicity_label
     FROM clinical_events
     ORDER BY event_datetime ASC`
  );
  console.table(eventsList.rows);

  await closeDbForTests();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("RESET_AND_SEED_ERROR:", err);
  await closeDbForTests().catch(() => {});
  process.exit(1);
});
