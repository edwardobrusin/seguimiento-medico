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
  ensureInitialized,
  getDbMode,
  query,
} from "../src/lib/db/client";
import { TelegramNotificationService } from "../src/lib/services/telegram-notification.service";

async function main() {
  console.log("DB_MODE:", getDbMode());
  await ensureInitialized();

  // Asegurar migracion idempotente de columna units_per_package y valor de Adalimumab
  await query(
    `ALTER TABLE medications
     ADD COLUMN IF NOT EXISTS units_per_package NUMERIC(10, 2) NOT NULL DEFAULT 30`
  );
  await query(
    `UPDATE medications
     SET units_per_package = 2
     WHERE name = 'Adalimumab 40mg' AND units_per_package = 30`
  );

  const meds = await query<{ c: number }>(
    "SELECT count(*)::int AS c FROM medications"
  );
  const events = await query<{ c: number }>(
    "SELECT count(*)::int AS c FROM clinical_events"
  );
  const topics = await query<{ c: number }>(
    "SELECT count(*)::int AS c FROM follow_up_topics"
  );
  const clusters = await query<{ c: number }>(
    "SELECT count(*)::int AS c FROM intake_clusters"
  );
  console.log("NEON_COUNTS:", {
    clusters: clusters.rows[0].c,
    medications: meds.rows[0].c,
    clinical_events: events.rows[0].c,
    follow_up_topics: topics.rows[0].c,
  });

  const bot = await TelegramNotificationService.testBotConnection();
  console.log("TELEGRAM_BOT:", bot);

  await closeDbForTests();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("INIT_NEON_ERROR:", err);
  await closeDbForTests().catch(() => {});
  process.exit(1);
});
