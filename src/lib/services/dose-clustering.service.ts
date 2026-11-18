import { query, withTransaction } from "@/lib/db/client";
import { INTAKE_RULE_LABEL } from "@/lib/clinical-labels";
import type {
  IntakeConstraint,
  IntakeStatus,
  MedFrequencyType,
  Medication,
  MedicationScheduleSummary,
} from "@/lib/types/clinical";

export interface CreateMedicationInput {
  id?: string;
  name: string;
  active_ingredient?: string | null;
  presentation: string;
  units_per_package?: number;
  dose_amount: number;
  current_stock: number;
  frequency_type: MedFrequencyType;
  frequency_value: number;
  tolerance_window_mins: number;
  intake_rule: IntakeConstraint;
  clinical_notes?: string | null;
  ideal_times?: string[];
}

interface ClusterRow {
  id: string;
  label: string;
  anchor_time: string;
  intake_rule: IntakeConstraint;
}

function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.trim().split(":");
  const hh = Number(parts[0] ?? 0);
  const mm = Number(parts[1] ?? 0);
  return ((hh * 60 + mm) % 1440 + 1440) % 1440;
}

function minutesToPgTime(totalMinutes: number): string {
  const norm = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(norm / 60)).padStart(2, "0");
  const mm = String(norm % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

function circularMinutesDiff(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

function defaultIdealTimesForFrequency(
  frequencyType: MedFrequencyType,
  frequencyValue: number,
  provided?: string[]
): string[] {
  if (provided && provided.length > 0) {
    return provided.map((t) =>
      t.length === 5 ? `${t}:00` : t.slice(0, 8)
    );
  }
  if (frequencyType === "FIXED_HOURS") {
    const step = Math.max(1, frequencyValue) * 60;
    const count = Math.max(1, Math.min(12, Math.floor(1440 / step)));
    const startMins = 8 * 60;
    return Array.from({ length: count }, (_, idx) =>
      minutesToPgTime(startMins + idx * step)
    );
  }
  if (frequencyType === "DAILY_SLOTS") {
    if (frequencyValue <= 1) return ["08:00:00"];
    if (frequencyValue === 2) return ["08:00:00", "20:00:00"];
    if (frequencyValue === 3) return ["08:00:00", "16:00:00", "22:00:00"];
    return ["07:00:00", "12:00:00", "17:00:00", "22:00:00"].slice(
      0,
      frequencyValue
    );
  }
  return ["08:00:00"];
}

export class DoseClusteringService {
  static calculateDailyConsumptionRate(
    doseAmount: number,
    frequencyType: MedFrequencyType,
    frequencyValue: number
  ): number {
    const safeVal = Math.max(1, frequencyValue);
    switch (frequencyType) {
      case "FIXED_HOURS":
        return Number(((24 / safeVal) * doseAmount).toFixed(4));
      case "DAILY_SLOTS":
        return Number((safeVal * doseAmount).toFixed(4));
      case "INTERVAL_DAYS":
        return Number((doseAmount / safeVal).toFixed(4));
      case "INTERVAL_WEEKS":
        return Number((doseAmount / (safeVal * 7)).toFixed(4));
    }
  }

  static areConstraintsCompatible(
    medRule: IntakeConstraint,
    clusterRule: IntakeConstraint,
    existingRulesInCluster: IntakeConstraint[]
  ): boolean {
    if (
      medRule === "SEPARATE_FROM_OTHERS" ||
      existingRulesInCluster.includes("SEPARATE_FROM_OTHERS")
    ) {
      return existingRulesInCluster.length === 0;
    }

    if (medRule === "FASTING") {
      return (
        clusterRule === "FASTING" ||
        (clusterRule === "NONE" && !existingRulesInCluster.includes("WITH_FOOD"))
      );
    }

    if (medRule === "WITH_FOOD") {
      return (
        clusterRule === "WITH_FOOD" ||
        (clusterRule === "NONE" && !existingRulesInCluster.includes("FASTING"))
      );
    }

    return true;
  }

  static async createOrUpdateMedication(
    input: CreateMedicationInput
  ): Promise<Medication> {
    const dailyRate = this.calculateDailyConsumptionRate(
      input.dose_amount,
      input.frequency_type,
      input.frequency_value
    );

    const unitsPerPkg =
      input.units_per_package && input.units_per_package > 0
        ? input.units_per_package
        : 30;

    const medResult = await query<Medication>(
      input.id
        ? `UPDATE medications
           SET name = $2,
               active_ingredient = $3,
               presentation = $4,
               units_per_package = $5,
               dose_amount = $6,
               current_stock = $7,
               frequency_type = $8::med_frequency_type,
               frequency_value = $9,
               tolerance_window_mins = $10,
               intake_rule = $11::intake_constraint,
               daily_consumption_rate = $12,
               clinical_notes = $13,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`
        : `INSERT INTO medications (
             name, active_ingredient, presentation, units_per_package, dose_amount, current_stock,
             frequency_type, frequency_value, tolerance_window_mins, intake_rule,
             daily_consumption_rate, clinical_notes
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7::med_frequency_type, $8, $9, $10::intake_constraint,
             $11, $12
           )
           RETURNING *`,
      input.id
        ? [
            input.id,
            input.name,
            input.active_ingredient ?? null,
            input.presentation,
            unitsPerPkg,
            input.dose_amount,
            input.current_stock,
            input.frequency_type,
            input.frequency_value,
            input.tolerance_window_mins,
            input.intake_rule,
            dailyRate,
            input.clinical_notes ?? null,
          ]
        : [
            input.name,
            input.active_ingredient ?? null,
            input.presentation,
            unitsPerPkg,
            input.dose_amount,
            input.current_stock,
            input.frequency_type,
            input.frequency_value,
            input.tolerance_window_mins,
            input.intake_rule,
            dailyRate,
            input.clinical_notes ?? null,
          ]
    );

    const medication = medResult.rows[0];
    await this.optimizeMedicationSchedules(medication.id, input.ideal_times);
    await this.generateDailyIntakeLogsAndAlerts();
    return medication;
  }

  static async optimizeMedicationSchedules(
    medicationId: string,
    baseIdealTimes?: string[]
  ): Promise<MedicationScheduleSummary[]> {
    const medRes = await query<Medication>(
      `SELECT * FROM medications WHERE id = $1`,
      [medicationId]
    );
    const med = medRes.rows[0];
    if (!med) {
      throw new Error("Medicamento no encontrado para optimizar horarios.");
    }

    const clustersRes = await query<ClusterRow>(
      `SELECT id, label, anchor_time::text AS anchor_time, intake_rule
       FROM intake_clusters
       WHERE is_active = TRUE
       ORDER BY anchor_time ASC`
    );
    const clusters = clustersRes.rows;

    const existingRulesRes = await query<{
      cluster_id: string;
      intake_rule: IntakeConstraint;
    }>(
      `SELECT ms.cluster_id, m.intake_rule
       FROM medication_schedules ms
       JOIN medications m ON m.id = ms.medication_id
       WHERE ms.is_active = TRUE
         AND ms.cluster_id IS NOT NULL
         AND ms.medication_id != $1`,
      [medicationId]
    );

    const rulesByCluster = new Map<string, IntakeConstraint[]>();
    for (const row of existingRulesRes.rows) {
      const list = rulesByCluster.get(row.cluster_id) ?? [];
      list.push(row.intake_rule);
      rulesByCluster.set(row.cluster_id, list);
    }

    const idealTimes = defaultIdealTimesForFrequency(
      med.frequency_type,
      med.frequency_value,
      baseIdealTimes
    );
    const tolerance = Math.max(0, med.tolerance_window_mins);

    let slotAssignments: Array<{
      ideal_time: string;
      cluster_id: string | null;
      cluster_label: string | null;
      effective_clustered_time: string;
    }> = [];

    if (med.frequency_type === "FIXED_HOURS") {
      // Construir serie diaria completa y evaluar desplazamientos simetricos dentro de [-tolerance, +tolerance]
      const stepMins = Math.max(1, med.frequency_value) * 60;
      const count = Math.max(1, Math.min(12, Math.floor(1440 / stepMins)));
      const anchorStart = parseTimeToMinutes(idealTimes[0] ?? "08:00:00");
      const baseSlots = Array.from(
        { length: count },
        (_, idx) => (anchorStart + idx * stepMins) % 1440
      );

      let bestScore = -1;
      let bestAssignments: typeof slotAssignments = [];

      for (let delta = -tolerance; delta <= tolerance; delta += 5) {
        let matches = 0;
        let penalty = Math.abs(delta) * 0.01;
        const candidateAssignments: typeof slotAssignments = [];

        for (const baseMin of baseSlots) {
          const shiftedMin = ((baseMin + delta) % 1440 + 1440) % 1440;
          let matchedCluster: ClusterRow | null = null;
          let bestClusterDiff = Number.POSITIVE_INFINITY;

          for (const cluster of clusters) {
            const existingRules = rulesByCluster.get(cluster.id) ?? [];
            if (
              !this.areConstraintsCompatible(
                med.intake_rule,
                cluster.intake_rule,
                existingRules
              )
            ) {
              continue;
            }
            const clusterMin = parseTimeToMinutes(cluster.anchor_time);
            const diff = circularMinutesDiff(shiftedMin, clusterMin);
            if (diff <= tolerance && diff < bestClusterDiff) {
              bestClusterDiff = diff;
              matchedCluster = cluster;
            }
          }

          if (matchedCluster) {
            matches += 1;
            penalty += bestClusterDiff;
            candidateAssignments.push({
              ideal_time: minutesToPgTime(baseMin),
              cluster_id: matchedCluster.id,
              cluster_label: matchedCluster.label,
              effective_clustered_time: matchedCluster.anchor_time,
            });
          } else {
            candidateAssignments.push({
              ideal_time: minutesToPgTime(baseMin),
              cluster_id: null,
              cluster_label: null,
              effective_clustered_time: minutesToPgTime(shiftedMin),
            });
          }
        }

        const score = matches * 10000 - penalty;
        if (score > bestScore) {
          bestScore = score;
          bestAssignments = candidateAssignments;
        }
      }

      slotAssignments = bestAssignments;
    } else {
      slotAssignments = idealTimes.map((timeStr) => {
        const idealMin = parseTimeToMinutes(timeStr);
        let matchedCluster: ClusterRow | null = null;
        let bestDiff = Number.POSITIVE_INFINITY;

        for (const cluster of clusters) {
          const existingRules = rulesByCluster.get(cluster.id) ?? [];
          if (
            !this.areConstraintsCompatible(
              med.intake_rule,
              cluster.intake_rule,
              existingRules
            )
          ) {
            continue;
          }
          const clusterMin = parseTimeToMinutes(cluster.anchor_time);
          const diff = circularMinutesDiff(idealMin, clusterMin);
          if (diff <= tolerance && diff < bestDiff) {
            bestDiff = diff;
            matchedCluster = cluster;
          }
        }

        return {
          ideal_time: minutesToPgTime(idealMin),
          cluster_id: matchedCluster?.id ?? null,
          cluster_label: matchedCluster?.label ?? null,
          effective_clustered_time:
            matchedCluster?.anchor_time ?? minutesToPgTime(idealMin),
        };
      });
    }

    const created: MedicationScheduleSummary[] = [];

    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE medication_schedules
         SET is_active = FALSE
         WHERE medication_id = $1`,
        [medicationId]
      );

      for (const slot of slotAssignments) {
        const res = await tx.query<{ id: string }>(
          `INSERT INTO medication_schedules (
             medication_id, cluster_id, ideal_time, effective_clustered_time, is_active
           ) VALUES ($1, $2, $3::time, $4::time, TRUE)
           RETURNING id`,
          [
            medicationId,
            slot.cluster_id,
            slot.ideal_time,
            slot.effective_clustered_time,
          ]
        );
        created.push({
          schedule_id: res.rows[0].id,
          cluster_id: slot.cluster_id,
          cluster_label: slot.cluster_label,
          ideal_time: slot.ideal_time,
          effective_clustered_time: slot.effective_clustered_time,
          day_of_week: null,
        });
      }
    });

    return created;
  }

  static async generateDailyIntakeLogsAndAlerts(
    targetDateStr?: string
  ): Promise<{ createdLogs: number; queuedNotifications: number }> {
    const dateStr = targetDateStr ?? new Date().toISOString().slice(0, 10);

    const schedulesRes = await query<{
      schedule_id: string;
      medication_id: string;
      cluster_id: string | null;
      effective_clustered_time: string;
      dose_amount: number;
      frequency_type: MedFrequencyType;
      frequency_value: number;
      created_date: string;
      has_active_event: boolean;
    }>(
      `SELECT
         ms.id AS schedule_id,
         m.id AS medication_id,
         ms.cluster_id,
         ms.effective_clustered_time::text AS effective_clustered_time,
         m.dose_amount::float8 AS dose_amount,
         m.frequency_type,
         m.frequency_value,
         (m.created_at AT TIME ZONE 'UTC')::date::text AS created_date,
         EXISTS (
           SELECT 1 FROM clinical_events ce
           WHERE ce.medication_id = m.id AND ce.is_completed = FALSE
         ) AS has_active_event
       FROM medication_schedules ms
       JOIN medications m ON m.id = ms.medication_id
       WHERE ms.is_active = TRUE
         AND m.is_active = TRUE`
    );

    let createdLogs = 0;

    for (const row of schedulesRes.rows) {
      if (
        row.frequency_type === "INTERVAL_DAYS" ||
        row.frequency_type === "INTERVAL_WEEKS"
      ) {
        if (row.has_active_event) {
          continue;
        }
        const intervalDays =
          row.frequency_type === "INTERVAL_WEEKS"
            ? row.frequency_value * 7
            : row.frequency_value;
        const createdMs = new Date(`${row.created_date}T00:00:00Z`).getTime();
        const targetMs = new Date(`${dateStr}T00:00:00Z`).getTime();
        const diffDays = Math.floor((targetMs - createdMs) / 86400000);
        if (diffDays < 0 || diffDays % Math.max(1, intervalDays) !== 0) {
          continue;
        }
      }

      const existsRes = await query<{ id: string }>(
        `SELECT id FROM intake_logs
         WHERE medication_id = $1
           AND schedule_id = $2
           AND (scheduled_for AT TIME ZONE 'UTC')::date = $3::date
         LIMIT 1`,
        [row.medication_id, row.schedule_id, dateStr]
      );

      if (existsRes.rows.length === 0) {
        const scheduledIso = `${dateStr} ${row.effective_clustered_time}+00`;
        await query(
          `INSERT INTO intake_logs (
             medication_id, schedule_id, cluster_id, scheduled_for, status, quantity_deducted
           ) VALUES ($1, $2, $3, $4::timestamptz, 'PENDING', $5)`,
          [
            row.medication_id,
            row.schedule_id,
            row.cluster_id,
            scheduledIso,
            row.dose_amount,
          ]
        );
        createdLogs += 1;
      }
    }

    // Consolidar recordatorios por bloque horario en notification_queue
    const clusterGroupsRes = await query<{
      cluster_id: string;
      cluster_label: string;
      anchor_time: string;
      med_name: string;
      quantity_deducted: number;
      presentation: string;
      intake_rule: IntakeConstraint;
    }>(
      `SELECT
         ic.id AS cluster_id,
         ic.label AS cluster_label,
         ic.anchor_time::text AS anchor_time,
         m.name AS med_name,
         il.quantity_deducted::float8 AS quantity_deducted,
         m.presentation,
         m.intake_rule
       FROM intake_logs il
       JOIN intake_clusters ic ON ic.id = il.cluster_id
       JOIN medications m ON m.id = il.medication_id
       WHERE (il.scheduled_for AT TIME ZONE 'UTC')::date = $1::date
         AND il.status = 'PENDING'
       ORDER BY ic.anchor_time ASC, m.name ASC`,
      [dateStr]
    );

    const grouped = new Map<
      string,
      {
        label: string;
        anchor_time: string;
        items: Array<{ name: string; dose: string; ruleLabel: string }>;
      }
    >();

    for (const r of clusterGroupsRes.rows) {
      const existing = grouped.get(r.cluster_id) ?? {
        label: r.cluster_label,
        anchor_time: r.anchor_time,
        items: [],
      };
      existing.items.push({
        name: r.med_name,
        dose: `${r.quantity_deducted} ${r.presentation}`,
        ruleLabel: INTAKE_RULE_LABEL[r.intake_rule],
      });
      grouped.set(r.cluster_id, existing);
    }

    let queuedNotifications = 0;

    for (const [clusterId, data] of grouped.entries()) {
      const hhmm = data.anchor_time.slice(0, 5);
      const itemLines = data.items.map(
        (it, i) =>
          `<b>${i + 1}. ${it.name}</b> | Dosis: ${it.dose} | Regla: ${it.ruleLabel}`
      );
      const message = [
        `<b>[BLOQUE DE MEDICACION - ${hhmm}]</b>`,
        "----------------------------------------",
        ...itemLines,
        "----------------------------------------",
        "Estado: PENDIENTE DE CONFIRMACION",
      ].join("\n");

      const idempotencyKey = `CLUSTER_${clusterId}_${dateStr}`;
      const callbackPayload = `ack_cluster:${clusterId}:${dateStr}`;
      const triggerAt = `${dateStr} ${data.anchor_time}+00`;

      const insRes = await query<{ id: string }>(
        `INSERT INTO notification_queue (
           source_type, source_id, stage, trigger_at, status,
           title, message, callback_action_payload, idempotency_key
         ) VALUES (
           'MEDICATION_INTAKE', $1, 'EXACT_TIME', $2::timestamptz, 'QUEUED',
           $3, $4, $5, $6
         )
         ON CONFLICT (idempotency_key) DO UPDATE
         SET message = CASE
           WHEN notification_queue.status = 'QUEUED' THEN EXCLUDED.message
           ELSE notification_queue.message
         END
         RETURNING id`,
        [
          clusterId,
          triggerAt,
          `[BLOQUE DE MEDICACION - ${hhmm}] ${data.label}`,
          message,
          callbackPayload,
          idempotencyKey,
        ]
      );
      if (insRes.rowCount > 0) {
        queuedNotifications += 1;
      }
    }

    return { createdLogs, queuedNotifications };
  }

  static async confirmClusterIntake(
    clusterId: string,
    dateStr: string,
    recordedBy: string,
    options?: { origin?: "WEB" | "TELEGRAM" }
  ): Promise<{ updatedCount: number; restockTriggered: string[] }> {
    const result = await withTransaction(async (tx) => {
      const updatedRes = await tx.query<{ medication_id: string }>(
        `UPDATE intake_logs
         SET status = 'TAKEN',
             taken_at = NOW(),
             recorded_by = $3
         WHERE cluster_id = $1
           AND (scheduled_for AT TIME ZONE 'UTC')::date = $2::date
           AND status = 'PENDING'
         RETURNING medication_id`,
        [clusterId, dateStr, recordedBy]
      );

      await tx.query(
        `UPDATE notification_queue
         SET status = 'ACKNOWLEDGED',
             acknowledged_at = NOW(),
             acknowledged_by_chat_id = $3
         WHERE source_type = 'MEDICATION_INTAKE'
           AND source_id = $1
           AND idempotency_key = $2
           AND status != 'ACKNOWLEDGED'`,
        [clusterId, `CLUSTER_${clusterId}_${dateStr}`, recordedBy]
      );

      const medIds = Array.from(
        new Set(updatedRes.rows.map((r) => r.medication_id))
      );
      const restockTriggered: string[] = [];

      if (medIds.length > 0) {
        const lowRes = await tx.query<{ name: string }>(
          `SELECT name FROM medications
           WHERE id = ANY($1::uuid[])
             AND days_of_supply_remaining <= 7`,
          [medIds]
        );
        for (const r of lowRes.rows) {
          restockTriggered.push(r.name);
        }
      }

      return {
        updatedCount: updatedRes.rowCount,
        restockTriggered,
      };
    });

    if (options?.origin !== "TELEGRAM") {
      const { TelegramNotificationService } = await import(
        "./telegram-notification.service"
      );
      await TelegramNotificationService.syncClusterStateFromWeb(
        clusterId,
        dateStr
      );
    }

    return result;
  }

  static async confirmSingleIntakeLog(
    intakeLogId: string,
    status: IntakeStatus,
    recordedBy: string,
    observations?: string,
    options?: { origin?: "WEB" | "TELEGRAM" }
  ): Promise<{ clusterId: string | null; dateStr: string | null }> {
    const res = await query<{
      cluster_id: string | null;
      date_str: string;
    }>(
      `UPDATE intake_logs
       SET status = $2::intake_status,
           taken_at = CASE WHEN $2::intake_status = 'TAKEN' THEN NOW() ELSE taken_at END,
           recorded_by = $3,
           observations = COALESCE($4, observations)
       WHERE id = $1
       RETURNING cluster_id, (scheduled_for AT TIME ZONE 'UTC')::date::text AS date_str`,
      [intakeLogId, status, recordedBy, observations ?? null]
    );

    const row = res.rows[0];
    if (options?.origin !== "TELEGRAM" && row?.cluster_id && row?.date_str) {
      const { TelegramNotificationService } = await import(
        "./telegram-notification.service"
      );
      await TelegramNotificationService.syncClusterStateFromWeb(
        row.cluster_id,
        row.date_str
      );
    }

    return {
      clusterId: row?.cluster_id ?? null,
      dateStr: row?.date_str ?? null,
    };
  }

  static async restockMedication(
    medicationId: string,
    quantityToAdd: number,
    recordedBy = "RESTOCK_WEB",
    options?: { origin?: "WEB" | "TELEGRAM" }
  ): Promise<Medication> {
    const { med, sentNotifications } = await withTransaction(async (tx) => {
      const res = await tx.query<Medication>(
        `UPDATE medications
         SET current_stock = current_stock + $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *,
           units_per_package::float8 AS units_per_package,
           dose_amount::float8 AS dose_amount,
           current_stock::float8 AS current_stock,
           daily_consumption_rate::float8 AS daily_consumption_rate,
           days_of_supply_remaining::float8 AS days_of_supply_remaining`,
        [medicationId, quantityToAdd]
      );

      const updatedMed = res.rows[0];
      if (!updatedMed) {
        throw new Error("Medicamento no encontrado para restock.");
      }

      const notifRes = await tx.query<{
        id: string;
        title: string;
        message: string;
        status: string;
        telegram_message_ids: unknown;
      }>(
        `WITH prev AS (
           SELECT id, title, message, status, telegram_message_ids
           FROM notification_queue
           WHERE source_type = 'RESTOCK_ALERT'
             AND source_id = $1
             AND status IN ('QUEUED', 'SENT')
         )
         UPDATE notification_queue nq
         SET status = 'ACKNOWLEDGED',
             acknowledged_at = NOW(),
             acknowledged_by_chat_id = $2
         FROM prev
         WHERE nq.id = prev.id
         RETURNING prev.id, prev.title, prev.message, prev.status, prev.telegram_message_ids`,
        [medicationId, recordedBy]
      );

      return {
        med: updatedMed,
        sentNotifications: notifRes.rows.filter((n) => n.status === "SENT"),
      };
    });

    if (options?.origin !== "TELEGRAM" && sentNotifications.length > 0) {
      const { TelegramNotificationService } = await import(
        "./telegram-notification.service"
      );
      await TelegramNotificationService.syncRestockFromWeb(
        med,
        sentNotifications
      );
    }

    return med;
  }
}
