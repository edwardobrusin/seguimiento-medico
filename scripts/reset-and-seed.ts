import { getDbMode, query, withTransaction } from "../src/lib/db/client";
import { seedClinicalDatabaseIfEmpty } from "../src/lib/db/seed";
import { formatActiveDaysLabel } from "../src/lib/periodicity";
import { getCommandCenterSnapshot } from "../src/lib/services/command-center.service";
import { DoseClusteringService } from "../src/lib/services/dose-clustering.service";

const PLACEHOLDER_CHAT_IDS = new Set(["100100001", "100100002", "100100003"]);

async function resetAndSeed() {
  console.log("=== REINICIO LIMPIO Y POBLACION DE BASE CLINICA ===");
  console.log(`Modo de Base de Datos: ${getDbMode()}`);

  const existingRecipientsRes = await query<{
    full_name: string;
    role: string;
    telegram_chat_id: string;
    receive_med_reminders: boolean;
    receive_restock_alerts: boolean;
    receive_event_reminders: boolean;
    receive_topic_reminders: boolean;
    receive_missed_block_alerts: boolean;
    receive_weekly_report: boolean;
    receive_change_alerts: boolean;
    is_active: boolean;
  }>(`SELECT * FROM telegram_recipients`).catch(() => ({ rows: [] }));

  const realRecipients = existingRecipientsRes.rows.filter(
    (r) => !PLACEHOLDER_CHAT_IDS.has(String(r.telegram_chat_id))
  );

  const tablesToTruncate = [
    "medication_versions",
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
    "alert_monitoring_settings",
    "auth_users",
    "telegram_recipients",
  ];

  await withTransaction(async (tx) => {
    for (const table of tablesToTruncate) {
      await tx.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    }
    await seedClinicalDatabaseIfEmpty(tx);

    for (const rec of realRecipients) {
      await tx.query(
        `INSERT INTO telegram_recipients (
           full_name,
           role,
           telegram_chat_id,
           receive_med_reminders,
           receive_restock_alerts,
           receive_event_reminders,
           receive_topic_reminders,
           receive_missed_block_alerts,
           receive_weekly_report,
           receive_change_alerts,
           is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (telegram_chat_id) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             role = EXCLUDED.role,
             is_active = EXCLUDED.is_active`,
        [
          rec.full_name,
          rec.role,
          rec.telegram_chat_id,
          rec.receive_med_reminders,
          rec.receive_restock_alerts,
          rec.receive_event_reminders,
          rec.receive_topic_reminders,
          rec.receive_missed_block_alerts ?? rec.role !== "PATIENT",
          rec.receive_weekly_report ?? rec.role !== "PATIENT",
          rec.receive_change_alerts ?? rec.role !== "PATIENT",
          rec.is_active,
        ]
      );
    }
  });

  await DoseClusteringService.generateDailyIntakeLogsAndAlerts();
  const snap = await getCommandCenterSnapshot(undefined, "ADMIN");
  const plan = snap.financial_plan;

  const medsRes = await query<{
    name: string;
    dose_amount: number;
    presentation: string;
    frequency_type: string;
    frequency_value: number;
    active_days: number[] | string | null;
    daily_consumption_rate: number;
    current_stock: number | null;
    package_price: number | null;
  }>(
    `SELECT name, dose_amount, presentation, frequency_type, frequency_value,
            active_days, daily_consumption_rate, current_stock, package_price
     FROM medications
     ORDER BY purchase_priority ASC, name ASC`
  );

  console.log("\n--- MEDICAMENTOS CARGADOS ---");
  console.table(
    medsRes.rows.map((m) => ({
      Medicamento: m.name,
      Dosis: `${m.dose_amount} ${m.presentation}`,
      Frecuencia: `${m.frequency_type} (${m.frequency_value})`,
      Dias: formatActiveDaysLabel(m.active_days),
      TasaDiaria: Number(m.daily_consumption_rate),
      Stock: m.current_stock ?? "PENDIENTE",
      PrecioCaja: m.package_price !== null ? `$${m.package_price}` : "PENDIENTE",
    }))
  );

  const eventsRes = await query<{
    title: string;
    category: string;
    event_datetime: string;
    date_is_estimated: boolean;
    estimated_cost: number | null;
  }>(
    `SELECT title, category, event_datetime, date_is_estimated, estimated_cost
     FROM clinical_events
     ORDER BY event_datetime ASC`
  );

  console.log("\n--- AGENDA CLINICA CARGADA ---");
  console.table(
    eventsRes.rows.map((e) => ({
      Evento: e.title,
      Categoria: e.category,
      Fecha: new Date(e.event_datetime).toISOString().slice(0, 16),
      EstadoFecha: e.date_is_estimated ? "ESTIMADA" : "OFICIAL",
      CostoEst: e.estimated_cost !== null ? `$${e.estimated_cost}` : "--",
    }))
  );

  console.log(
    `\nPlan Quincenal calculado: ${plan.buckets.length} quincenas | Gasto mensual proyectado: $${plan.summary.monthly_run_rate_total}`
  );
  console.log("=== BASE DE DATOS LISTA ===");
}

resetAndSeed().catch((err) => {
  console.error("Error en reset-and-seed:", err);
  process.exit(1);
});
