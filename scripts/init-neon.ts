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

  const [meds, events, topics, clusters, expenses, providers] = await Promise.all([
    query<{ c: number }>("SELECT count(*)::int AS c FROM medications"),
    query<{ c: number }>("SELECT count(*)::int AS c FROM clinical_events"),
    query<{ c: number }>("SELECT count(*)::int AS c FROM follow_up_topics"),
    query<{ c: number }>("SELECT count(*)::int AS c FROM intake_clusters"),
    query<{ c: number }>("SELECT count(*)::int AS c FROM medical_expenses"),
    query<{ c: number }>("SELECT count(*)::int AS c FROM care_providers"),
  ]);

  console.log("NEON_COUNTS:", {
    clusters: clusters.rows[0].c,
    medications: meds.rows[0].c,
    clinical_events: events.rows[0].c,
    follow_up_topics: topics.rows[0].c,
    medical_expenses: expenses.rows[0].c,
    care_providers: providers.rows[0].c,
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
