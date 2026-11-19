import { query, withTransaction } from "@/lib/db/client";
import { INTAKE_RULE_LABEL } from "@/lib/clinical-labels";
import {
  calculateEffectiveDailyRate,
  isDateActiveForMedication,
  normalizeActiveDays,
} from "@/lib/periodicity";
import { getClinicalDateParts } from "@/lib/utils";
import type {
  IntakeCluster,
  IntakeConstraint,
  IntakeStatus,
  MedFrequencyType,
  Medication,
  MedicationScheduleSummary,
} from "@/lib/types/clinical";
import { inferQuincenaLabel } from "./financial-planner.service";
import { GovernanceAuditService } from "./governance-audit.service";
import {
  MedicationVersionService,
  type VersionActorContext,
} from "./medication-version.service";

export interface CreateMedicationInput {
  id?: string;
  name: string;
  active_ingredient?: string | null;
  presentation: string;
  units_per_package?: number | null;
  package_price?: number | null;
  dose_amount: number;
  current_stock?: number | null;
  frequency_type: MedFrequencyType;
  frequency_value: number;
  tolerance_window_mins: number;
  intake_rule: IntakeConstraint;
  active_days?: number[] | null;
  schedule_start_date?: string | null;
  preferred_pharmacy?: string | null;
  purchase_priority?: number;
  safety_buffer_days?: number;
  clinical_notes?: string | null;
  ideal_times?: string[];
  event_linked_only?: boolean;
}

export interface RestockOptions {
  origin?: "WEB" | "TELEGRAM";
  role?: "ADMIN" | "PATIENT" | "SYSTEM";
  package_price?: number | null;
  units_per_package?: number | null;
  expense_amount?: number | null;
  provider_or_pharmacy?: string | null;
  payment_method?: string | null;
  log_expense?: boolean;
}

interface ClusterRow {
  id: string;
  label: string;
  anchor_time: string;
  intake_rule: IntakeConstraint;
}

const MEDICATION_RETURNING = `
  *,
  units_per_package::float8 AS units_per_package,
  package_price::float8 AS package_price,
  dose_amount::float8 AS dose_amount,
  current_stock::float8 AS current_stock,
  schedule_start_date::text AS schedule_start_date,
  daily_consumption_rate::float8 AS daily_consumption_rate,
  days_of_supply_remaining::float8 AS days_of_supply_remaining
`;

function resolveContext(
  actorOrCtx?: string | VersionActorContext
): VersionActorContext {
  if (!actorOrCtx) {
    return { role: "ADMIN", actor: "Consola Clinica Web" };
  }
  if (typeof actorOrCtx === "string") {
    return { role: "ADMIN", actor: actorOrCtx };
  }
  return actorOrCtx;
}

function normalizeMedicationRow(med: Medication): Medication {
  return {
    ...med,
    active_days: normalizeActiveDays(med.active_days),
  };
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

function normalizePgTime(timeStr: string): string {
  const parts = timeStr.trim().split(":");
  const hh = String(Number(parts[0] ?? 0)).padStart(2, "0");
  const mm = String(Number(parts[1] ?? 0)).padStart(2, "0");
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
    if (frequencyValue === 2) return ["08:00:00", "21:00:00"];
    if (frequencyValue === 3) return ["08:00:00", "15:00:00", "21:00:00"];
    return ["08:00:00", "12:00:00", "16:00:00", "21:00:00"].slice(
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
    frequencyValue: number,
    activeDays?: number[] | null
  ): number {
    return calculateEffectiveDailyRate(
      doseAmount,
      frequencyType,
      frequencyValue,
      activeDays
    );
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
    input: CreateMedicationInput,
    actorOrCtx: string | VersionActorContext = "Consola Clinica Web"
  ): Promise<Medication> {
    const ctx = resolveContext(actorOrCtx);
    const activeDays = normalizeActiveDays(input.active_days);
    const scheduleStartDate = input.schedule_start_date?.trim() || null;

    const dailyRate = this.calculateDailyConsumptionRate(
      input.dose_amount,
      input.frequency_type,
      input.frequency_value,
      activeDays
    );

    const unitsPerPkg =
      input.units_per_package !== undefined &&
      input.units_per_package !== null &&
      input.units_per_package > 0
        ? input.units_per_package
        : null;

    const packagePrice =
      input.package_price !== undefined &&
      input.package_price !== null &&
      input.package_price >= 0
        ? input.package_price
        : null;

    const currentStock =
      input.current_stock !== undefined &&
      input.current_stock !== null &&
      input.current_stock >= 0
        ? input.current_stock
        : null;

    const purchasePriority = input.purchase_priority ?? 2;
    const safetyBufferDays = input.safety_buffer_days ?? 7;

    let beforeSnap = null;
    if (input.id) {
      beforeSnap = await MedicationVersionService.buildMedicationSnapshot(
        input.id
      );
      if (beforeSnap) {
        await MedicationVersionService.ensureBaselineVersion(
          input.id,
          beforeSnap
        );
      }
    }

    const medResult = await query<Medication>(
      input.id
        ? `UPDATE medications
           SET name = $2,
               active_ingredient = $3,
               presentation = $4,
               units_per_package = $5,
               package_price = $6,
               dose_amount = $7,
               current_stock = $8,
               frequency_type = $9::med_frequency_type,
               frequency_value = $10,
               tolerance_window_mins = $11,
               intake_rule = $12::intake_constraint,
               active_days = $13::jsonb,
               schedule_start_date = $14::date,
               daily_consumption_rate = $15,
               preferred_pharmacy = $16,
               purchase_priority = $17,
               safety_buffer_days = $18,
               clinical_notes = $19,
               updated_at = NOW()
           WHERE id = $1::uuid
           RETURNING ${MEDICATION_RETURNING}`
        : `INSERT INTO medications (
             name, active_ingredient, presentation, units_per_package, package_price,
             dose_amount, current_stock, frequency_type, frequency_value,
             tolerance_window_mins, intake_rule, active_days, schedule_start_date,
             daily_consumption_rate, preferred_pharmacy, purchase_priority,
             safety_buffer_days, clinical_notes
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8::med_frequency_type, $9,
             $10, $11::intake_constraint, $12::jsonb, $13::date,
             $14, $15, $16,
             $17, $18
           )
           RETURNING ${MEDICATION_RETURNING}`,
      input.id
        ? [
            input.id,
            input.name.trim(),
            input.active_ingredient?.trim() || null,
            input.presentation.trim(),
            unitsPerPkg,
            packagePrice,
            input.dose_amount,
            currentStock,
            input.frequency_type,
            input.frequency_value,
            input.tolerance_window_mins,
            input.intake_rule,
            activeDays ? JSON.stringify(activeDays) : null,
            scheduleStartDate,
            dailyRate,
            input.preferred_pharmacy?.trim() || null,
            purchasePriority,
            safetyBufferDays,
            input.clinical_notes?.trim() || null,
          ]
        : [
            input.name.trim(),
            input.active_ingredient?.trim() || null,
            input.presentation.trim(),
            unitsPerPkg,
            packagePrice,
            input.dose_amount,
            currentStock,
            input.frequency_type,
            input.frequency_value,
            input.tolerance_window_mins,
            input.intake_rule,
            activeDays ? JSON.stringify(activeDays) : null,
            scheduleStartDate,
            dailyRate,
            input.preferred_pharmacy?.trim() || null,
            purchasePriority,
            safetyBufferDays,
            input.clinical_notes?.trim() || null,
          ]
    );

    const medicationRow = medResult.rows[0];
    if (!medicationRow) {
      throw new Error("No se pudo guardar el medicamento solicitado.");
    }
    const medication = normalizeMedicationRow(medicationRow);

    await this.optimizeMedicationSchedules(medication.id, input.ideal_times, {
      eventLinkedOnly: input.event_linked_only,
    });

    if (input.id) {
      const todayStr = getClinicalDateParts("America/Mexico_City").dateStr;
      await query(
        `DELETE FROM intake_logs
         WHERE medication_id = $1::uuid
           AND status = 'PENDING'
           AND (scheduled_for AT TIME ZONE 'America/Mexico_City')::date = $2::date`,
        [medication.id, todayStr]
      );
    }

    await this.generateDailyIntakeLogsAndAlerts();

    const afterSnap = await MedicationVersionService.buildMedicationSnapshot(
      medication.id
    );
    if (afterSnap) {
      await MedicationVersionService.recordMedicationVersion({
        medicationId: medication.id,
        action: input.id ? "UPDATE" : "CREATE",
        context: ctx,
        summary: input.id
          ? `Medicamento "${medication.name}" actualizado (dosis ${medication.dose_amount} ${medication.presentation}, tasa ${medication.daily_consumption_rate}/dia).`
          : `Medicamento "${medication.name}" registrado en catalogo clinico.`,
        beforeSnapshot: beforeSnap,
        afterSnapshot: afterSnap,
      });
    }

    await GovernanceAuditService.log({
      entity_type: "MEDICATION",
      entity_id: medication.id,
      entity_label: medication.name,
      action: input.id ? "UPDATE" : "CREATE",
      actor: ctx.actor,
      summary: input.id
        ? `Medicamento "${medication.name}" actualizado (dosis ${medication.dose_amount} ${medication.presentation}, tasa ${medication.daily_consumption_rate}/dia).`
        : `Medicamento "${medication.name}" registrado en catalogo clinico.`,
    });

    return medication;
  }

  static async optimizeMedicationSchedules(
    medicationId: string,
    baseIdealTimes?: string[],
    options?: { eventLinkedOnly?: boolean }
  ): Promise<MedicationScheduleSummary[]> {
    if (options?.eventLinkedOnly) {
      await query(
        `UPDATE medication_schedules
         SET is_active = FALSE
         WHERE medication_id = $1::uuid`,
        [medicationId]
      );
      return [];
    }

    const medRes = await query<Medication>(
      `SELECT ${MEDICATION_RETURNING} FROM medications WHERE id = $1::uuid`,
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
         AND ms.medication_id != $1::uuid`,
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
         WHERE medication_id = $1::uuid`,
        [medicationId]
      );

      for (const slot of slotAssignments) {
        const res = await tx.query<{ id: string }>(
          `INSERT INTO medication_schedules (
             medication_id, cluster_id, ideal_time, effective_clustered_time, is_active
           ) VALUES ($1::uuid, $2::uuid, $3::time, $4::time, TRUE)
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
    const dateStr =
      targetDateStr ?? getClinicalDateParts("America/Mexico_City").dateStr;

    const schedulesRes = await query<{
      schedule_id: string;
      medication_id: string;
      cluster_id: string | null;
      effective_clustered_time: string;
      dose_amount: number;
      frequency_type: MedFrequencyType;
      frequency_value: number;
      active_days: unknown;
      schedule_start_date: string | null;
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
         m.active_days,
         m.schedule_start_date::text AS schedule_start_date,
         (m.created_at AT TIME ZONE 'America/Mexico_City')::date::text AS created_date,
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
        (row.frequency_type === "INTERVAL_DAYS" ||
          row.frequency_type === "INTERVAL_WEEKS") &&
        row.has_active_event
      ) {
        continue;
      }

      if (
        !isDateActiveForMedication(
          {
            frequency_type: row.frequency_type,
            frequency_value: row.frequency_value,
            active_days: row.active_days as number[] | null,
            schedule_start_date: row.schedule_start_date,
            created_date: row.created_date,
          },
          dateStr
        )
      ) {
        continue;
      }

      const existsRes = await query<{ id: string }>(
        `SELECT id FROM intake_logs
         WHERE medication_id = $1::uuid
           AND schedule_id = $2::uuid
           AND (scheduled_for AT TIME ZONE 'America/Mexico_City')::date = $3::date
         LIMIT 1`,
        [row.medication_id, row.schedule_id, dateStr]
      );

      if (existsRes.rows.length === 0) {
        const localTimestampStr = `${dateStr} ${row.effective_clustered_time}`;
        await query(
          `INSERT INTO intake_logs (
             medication_id, schedule_id, cluster_id, scheduled_for, status, quantity_deducted
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid,
             (($4::text)::timestamp AT TIME ZONE 'America/Mexico_City'),
             'PENDING', $5
           )`,
          [
            row.medication_id,
            row.schedule_id,
            row.cluster_id,
            localTimestampStr,
            row.dose_amount,
          ]
        );
        createdLogs += 1;
      }
    }

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
       WHERE (il.scheduled_for AT TIME ZONE 'America/Mexico_City')::date = $1::date
         AND il.status = 'PENDING'
         AND m.is_active = TRUE
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
      const triggerLocalStr = `${dateStr} ${data.anchor_time}`;

      const insRes = await query<{ id: string }>(
        `INSERT INTO notification_queue (
           source_type, source_id, stage, trigger_at, status,
           title, message, callback_action_payload, idempotency_key
         ) VALUES (
           'MEDICATION_INTAKE', $1::uuid, 'EXACT_TIME',
           (($2::text)::timestamp AT TIME ZONE 'America/Mexico_City'),
           'QUEUED', $3, $4, $5, $6
         )
         ON CONFLICT (idempotency_key) DO UPDATE
         SET message = CASE
           WHEN notification_queue.status = 'QUEUED' THEN EXCLUDED.message
           ELSE notification_queue.message
         END
         RETURNING id`,
        [
          clusterId,
          triggerLocalStr,
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
         WHERE cluster_id = $1::uuid
           AND (scheduled_for AT TIME ZONE 'America/Mexico_City')::date = $2::date
           AND status = 'PENDING'
         RETURNING medication_id`,
        [clusterId, dateStr, recordedBy]
      );

      await tx.query(
        `UPDATE notification_queue
         SET status = 'ACKNOWLEDGED',
             acknowledged_at = NOW(),
             acknowledged_by_chat_id = $3
         WHERE idempotency_key IN ($2, $4)
           AND status != 'ACKNOWLEDGED'`,
        [
          clusterId,
          `CLUSTER_${clusterId}_${dateStr}`,
          recordedBy,
          `MISSED_CLUSTER_${clusterId}_${dateStr}`,
        ]
      );

      const medIds = Array.from(
        new Set(updatedRes.rows.map((r) => r.medication_id))
      );
      const restockTriggered: string[] = [];

      if (medIds.length > 0) {
        const lowRes = await tx.query<{ name: string }>(
          `SELECT name FROM medications
           WHERE id = ANY($1::uuid[])
             AND days_of_supply_remaining IS NOT NULL
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
    const hasObservations = observations !== undefined;
    const res = await query<{
      cluster_id: string | null;
      date_str: string;
      medication_id: string;
    }>(
      `UPDATE intake_logs
       SET status = $2::intake_status,
           taken_at = CASE
             WHEN $2::intake_status = 'TAKEN' THEN COALESCE(taken_at, NOW())
             ELSE NULL
           END,
           recorded_by = $3,
           observations = CASE WHEN $5::boolean THEN $4 ELSE observations END
       WHERE id = $1::uuid
       RETURNING cluster_id, (scheduled_for AT TIME ZONE 'America/Mexico_City')::date::text AS date_str, medication_id`,
      [intakeLogId, status, recordedBy, observations ?? null, hasObservations]
    );

    const row = res.rows[0];
    if (row?.cluster_id && row?.date_str && status !== "PENDING") {
      const pendingRemRes = await query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM intake_logs
         WHERE cluster_id = $1::uuid
           AND (scheduled_for AT TIME ZONE 'America/Mexico_City')::date = $2::date
           AND status = 'PENDING'`,
        [row.cluster_id, row.date_str]
      );
      if (Number(pendingRemRes.rows[0]?.c ?? "0") === 0) {
        await query(
          `UPDATE notification_queue
           SET status = 'ACKNOWLEDGED',
               acknowledged_at = NOW(),
               acknowledged_by_chat_id = $2
           WHERE idempotency_key = $1
             AND status != 'ACKNOWLEDGED'`,
          [`MISSED_CLUSTER_${row.cluster_id}_${row.date_str}`, recordedBy]
        );
      }
    }

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

  static async deleteIntakeLog(
    intakeLogId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string; clusterId: string | null; dateStr: string | null }> {
    const res = await query<{
      id: string;
      cluster_id: string | null;
      date_str: string;
      medication_id: string;
      status: IntakeStatus;
    }>(
      `DELETE FROM intake_logs
       WHERE id = $1::uuid
       RETURNING id, cluster_id, (scheduled_for AT TIME ZONE 'America/Mexico_City')::date::text AS date_str, medication_id, status`,
      [intakeLogId]
    );
    const deleted = res.rows[0];
    if (!deleted) {
      throw new Error("Registro de toma no encontrado.");
    }

    await GovernanceAuditService.log({
      entity_type: "INTAKE_LOG",
      entity_id: deleted.id,
      entity_label: `Toma ${deleted.date_str}`,
      action: "DELETE",
      actor,
      summary: `Registro de toma (${deleted.status}) eliminado (reembolso automatico aplicado si estaba TAKEN).`,
    });

    if (deleted.cluster_id && deleted.date_str) {
      const { TelegramNotificationService } = await import(
        "./telegram-notification.service"
      );
      await TelegramNotificationService.syncClusterStateFromWeb(
        deleted.cluster_id,
        deleted.date_str
      );
    }

    return {
      deletedId: deleted.id,
      clusterId: deleted.cluster_id,
      dateStr: deleted.date_str,
    };
  }

  static async restockMedication(
    medicationId: string,
    quantityToAdd: number,
    recordedBy = "RESTOCK_WEB",
    options?: RestockOptions
  ): Promise<Medication> {
    const actorRole: "ADMIN" | "PATIENT" | "SYSTEM" =
      options?.role ?? "ADMIN";

    const { med, sentNotifications } = await withTransaction(async (tx) => {
      const beforeSnap = await MedicationVersionService.buildMedicationSnapshot(
        medicationId,
        tx
      );
      if (!beforeSnap) {
        throw new Error("Medicamento no encontrado para restock.");
      }
      await MedicationVersionService.ensureBaselineVersion(
        medicationId,
        beforeSnap,
        tx
      );

      const res = await tx.query<Medication>(
        `UPDATE medications
         SET current_stock = COALESCE(current_stock, 0) + $2,
             package_price = COALESCE($3, package_price),
             units_per_package = COALESCE($4, units_per_package),
             preferred_pharmacy = COALESCE($5, preferred_pharmacy),
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING ${MEDICATION_RETURNING}`,
        [
          medicationId,
          quantityToAdd,
          options?.package_price ?? null,
          options?.units_per_package ?? null,
          options?.provider_or_pharmacy?.trim() || null,
        ]
      );

      const updatedMed = normalizeMedicationRow(res.rows[0]);

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
             AND source_id = $1::uuid
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

      if (
        options?.log_expense &&
        options.expense_amount !== undefined &&
        options.expense_amount !== null &&
        options.expense_amount >= 0
      ) {
        const todayIso = getClinicalDateParts("America/Mexico_City").dateStr;
        const pkgs =
          updatedMed.units_per_package && updatedMed.units_per_package > 0
            ? Number((quantityToAdd / updatedMed.units_per_package).toFixed(2))
            : null;
        await tx.query(
          `INSERT INTO medical_expenses (
             title, category, status, amount, expense_date, quincena_label,
             medication_id, packages_purchased, units_added, provider_or_pharmacy, payment_method
           ) VALUES (
             $1, 'MEDICATION', 'PAID', $2, $3::date, $4,
             $5::uuid, $6, $7, $8, $9
           )`,
          [
            `Restock ${updatedMed.name} (+${quantityToAdd} ${updatedMed.presentation})`,
            options.expense_amount,
            todayIso,
            inferQuincenaLabel(todayIso),
            updatedMed.id,
            pkgs,
            quantityToAdd,
            options.provider_or_pharmacy?.trim() || updatedMed.preferred_pharmacy || null,
            options.payment_method?.trim() || null,
          ]
        );
      }

      const afterSnap = await MedicationVersionService.buildMedicationSnapshot(
        medicationId,
        tx
      );
      if (afterSnap) {
        await MedicationVersionService.recordMedicationVersion(
          {
            medicationId,
            action: "RESTOCK",
            context: { role: actorRole, actor: recordedBy },
            summary: `Restock de +${quantityToAdd} ${updatedMed.presentation} en "${updatedMed.name}". Stock resultante: ${updatedMed.current_stock}.`,
            beforeSnapshot: beforeSnap,
            afterSnapshot: afterSnap,
          },
          tx
        );
      }

      await GovernanceAuditService.log(
        {
          entity_type: "MEDICATION",
          entity_id: updatedMed.id,
          entity_label: updatedMed.name,
          action: "RESTOCK",
          actor: recordedBy,
          summary: `Restock de +${quantityToAdd} ${updatedMed.presentation} en "${updatedMed.name}". Stock resultante: ${updatedMed.current_stock}.`,
        },
        tx
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
        {
          id: med.id,
          name: med.name,
          presentation: med.presentation,
          current_stock: med.current_stock ?? 0,
          days_of_supply_remaining: med.days_of_supply_remaining ?? 0,
        },
        sentNotifications
      );
    }

    return med;
  }

  static async adjustMedicationStock(
    medicationId: string,
    exactStock: number | null,
    reason: string,
    actorOrCtx: string | VersionActorContext = "Consola Clinica Web"
  ): Promise<Medication> {
    const ctx = resolveContext(actorOrCtx);

    const { med, sentNotifications } = await withTransaction(async (tx) => {
      const beforeSnap = await MedicationVersionService.buildMedicationSnapshot(
        medicationId,
        tx
      );
      if (!beforeSnap) {
        throw new Error("Medicamento no encontrado para ajustar stock.");
      }
      await MedicationVersionService.ensureBaselineVersion(
        medicationId,
        beforeSnap,
        tx
      );

      const res = await tx.query<Medication>(
        `UPDATE medications
         SET current_stock = $2,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING ${MEDICATION_RETURNING}`,
        [medicationId, exactStock]
      );
      const updated = normalizeMedicationRow(res.rows[0]);

      let closedSent: Array<{
        id: string;
        title: string;
        message: string;
        status: string;
        telegram_message_ids: unknown;
      }> = [];

      if (
        updated.days_of_supply_remaining === null ||
        updated.days_of_supply_remaining > 7
      ) {
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
               AND source_id = $1::uuid
               AND status IN ('QUEUED', 'SENT')
           )
           UPDATE notification_queue nq
           SET status = 'ACKNOWLEDGED',
               acknowledged_at = NOW(),
               acknowledged_by_chat_id = $2
           FROM prev
           WHERE nq.id = prev.id
           RETURNING prev.id, prev.title, prev.message, prev.status, prev.telegram_message_ids`,
          [medicationId, ctx.actor]
        );
        closedSent = notifRes.rows.filter((n) => n.status === "SENT");
      } else if (updated.days_of_supply_remaining <= 7) {
        const todayStr = getClinicalDateParts("America/Mexico_City").dateStr;
        await tx.query(
          `INSERT INTO notification_queue (
             source_type, source_id, stage, trigger_at, title, message, callback_action_payload, idempotency_key
           ) VALUES (
             'RESTOCK_ALERT', $1::uuid, 'LOW_STOCK_7D', NOW(),
             $2, $3, $4, $5
           ) ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            updated.id,
            `[ALERTA DE RESTOCK CRITICO] ${updated.name}`,
            `Inventario ajustado: ${updated.current_stock} (${updated.presentation}). Cobertura estimada: ${updated.days_of_supply_remaining} dias.`,
            `ack_restock:${updated.id}`,
            `RESTOCK_${updated.id}_${todayStr}`,
          ]
        );
      }

      const afterSnap = await MedicationVersionService.buildMedicationSnapshot(
        medicationId,
        tx
      );
      if (afterSnap) {
        await MedicationVersionService.recordMedicationVersion(
          {
            medicationId,
            action: "STOCK_ADJUST",
            context: ctx,
            summary: `Stock de "${updated.name}" ajustado a ${exactStock === null ? "PENDIENTE" : exactStock}. Motivo: ${reason || "Conteo fisico"}.`,
            beforeSnapshot: beforeSnap,
            afterSnapshot: afterSnap,
          },
          tx
        );
      }

      await GovernanceAuditService.log(
        {
          entity_type: "MEDICATION",
          entity_id: updated.id,
          entity_label: updated.name,
          action: "STOCK_ADJUST",
          actor: ctx.actor,
          summary: `Stock de "${updated.name}" ajustado a ${exactStock === null ? "PENDIENTE" : exactStock}. Motivo: ${reason || "Conteo fisico"}.`,
        },
        tx
      );

      return { med: updated, sentNotifications: closedSent };
    });

    if (sentNotifications.length > 0 && med.current_stock !== null) {
      const { TelegramNotificationService } = await import(
        "./telegram-notification.service"
      );
      await TelegramNotificationService.syncRestockFromWeb(
        {
          id: med.id,
          name: med.name,
          presentation: med.presentation,
          current_stock: med.current_stock,
          days_of_supply_remaining: med.days_of_supply_remaining ?? 0,
        },
        sentNotifications
      );
    }

    return med;
  }

  static async archiveMedication(
    medicationId: string,
    reason: string | null,
    actorOrCtx: string | VersionActorContext = "Consola Clinica Web"
  ): Promise<Medication> {
    const ctx = resolveContext(actorOrCtx);
    return withTransaction(async (tx) => {
      const beforeSnap = await MedicationVersionService.buildMedicationSnapshot(
        medicationId,
        tx
      );
      if (!beforeSnap) {
        throw new Error("Medicamento no encontrado para archivar.");
      }
      await MedicationVersionService.ensureBaselineVersion(
        medicationId,
        beforeSnap,
        tx
      );

      const res = await tx.query<Medication>(
        `UPDATE medications
         SET is_active = FALSE,
             archived_at = NOW(),
             discontinuation_reason = $2,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING ${MEDICATION_RETURNING}`,
        [medicationId, reason?.trim() || null]
      );
      const med = normalizeMedicationRow(res.rows[0]);

      const todayStr = getClinicalDateParts("America/Mexico_City").dateStr;
      await tx.query(
        `DELETE FROM intake_logs
         WHERE medication_id = $1::uuid
           AND status = 'PENDING'
           AND (scheduled_for AT TIME ZONE 'America/Mexico_City')::date = $2::date`,
        [medicationId, todayStr]
      );

      await tx.query(
        `UPDATE notification_queue
         SET status = 'ACKNOWLEDGED',
             acknowledged_at = NOW(),
             acknowledged_by_chat_id = $2
         WHERE source_type = 'RESTOCK_ALERT'
           AND source_id = $1::uuid
           AND status != 'ACKNOWLEDGED'`,
        [medicationId, ctx.actor]
      );

      const afterSnap = await MedicationVersionService.buildMedicationSnapshot(
        medicationId,
        tx
      );
      if (afterSnap) {
        await MedicationVersionService.recordMedicationVersion(
          {
            medicationId,
            action: "ARCHIVE",
            context: ctx,
            summary: `Medicamento "${med.name}" suspendido/archivado. Motivo: ${reason?.trim() || "Suspension clinica"}.`,
            beforeSnapshot: beforeSnap,
            afterSnapshot: afterSnap,
          },
          tx
        );
      }

      await GovernanceAuditService.log(
        {
          entity_type: "MEDICATION",
          entity_id: med.id,
          entity_label: med.name,
          action: "ARCHIVE",
          actor: ctx.actor,
          summary: `Medicamento "${med.name}" suspendido/archivado. Motivo: ${reason?.trim() || "Suspension clinica"}.`,
        },
        tx
      );

      return med;
    });
  }

  static async restoreMedication(
    medicationId: string,
    actorOrCtx: string | VersionActorContext = "Consola Clinica Web"
  ): Promise<Medication> {
    const ctx = resolveContext(actorOrCtx);
    const med = await withTransaction(async (tx) => {
      const beforeSnap = await MedicationVersionService.buildMedicationSnapshot(
        medicationId,
        tx
      );
      if (!beforeSnap) {
        throw new Error("Medicamento no encontrado para restaurar.");
      }
      await MedicationVersionService.ensureBaselineVersion(
        medicationId,
        beforeSnap,
        tx
      );

      const res = await tx.query<Medication>(
        `UPDATE medications
         SET is_active = TRUE,
             archived_at = NULL,
             discontinuation_reason = NULL,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING ${MEDICATION_RETURNING}`,
        [medicationId]
      );
      const restored = normalizeMedicationRow(res.rows[0]);

      const afterSnap = await MedicationVersionService.buildMedicationSnapshot(
        medicationId,
        tx
      );
      if (afterSnap) {
        await MedicationVersionService.recordMedicationVersion(
          {
            medicationId,
            action: "RESTORE",
            context: ctx,
            summary: `Medicamento "${restored.name}" reactivado en catalogo operativo.`,
            beforeSnapshot: beforeSnap,
            afterSnapshot: afterSnap,
          },
          tx
        );
      }

      await GovernanceAuditService.log(
        {
          entity_type: "MEDICATION",
          entity_id: restored.id,
          entity_label: restored.name,
          action: "RESTORE",
          actor: ctx.actor,
          summary: `Medicamento "${restored.name}" reactivado en catalogo operativo.`,
        },
        tx
      );

      return restored;
    });

    await this.generateDailyIntakeLogsAndAlerts();
    return med;
  }

  static async deleteMedicationPermanently(
    medicationId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    return withTransaction(async (tx) => {
      await tx.query(
        `DELETE FROM notification_queue
         WHERE source_type IN ('RESTOCK_ALERT', 'PATIENT_CHANGE_ALERT')
           AND source_id = $1::uuid`,
        [medicationId]
      );

      const res = await tx.query<{ id: string; name: string }>(
        `DELETE FROM medications
         WHERE id = $1::uuid
         RETURNING id, name`,
        [medicationId]
      );
      const deleted = res.rows[0];
      if (!deleted) {
        throw new Error("Medicamento no encontrado para eliminar.");
      }

      await GovernanceAuditService.log({
        entity_type: "MEDICATION",
        entity_id: deleted.id,
        entity_label: deleted.name,
        action: "DELETE",
        actor,
        summary: `Medicamento "${deleted.name}" eliminado permanentemente del sistema.`,
      }, tx);

      return { deletedId: deleted.id };
    });
  }

  static async createCluster(
    input: {
      label: string;
      anchor_time: string;
      intake_rule: IntakeConstraint;
    },
    actor = "Consola Clinica Web"
  ): Promise<IntakeCluster> {
    return withTransaction(async (tx) => {
      const pgTime = normalizePgTime(input.anchor_time);
      const res = await tx.query<IntakeCluster>(
        `INSERT INTO intake_clusters (label, anchor_time, intake_rule, is_active)
         VALUES ($1, $2::time, $3::intake_constraint, TRUE)
         RETURNING id, label, anchor_time::text AS anchor_time, intake_rule, is_active`,
        [input.label.trim(), pgTime, input.intake_rule]
      );
      const cluster = res.rows[0];
      await GovernanceAuditService.log(
        {
          entity_type: "INTAKE_CLUSTER",
          entity_id: cluster.id,
          entity_label: cluster.label,
          action: "CREATE",
          actor,
          summary: `Bloque horario "${cluster.label}" (${pgTime.slice(0, 5)}) creado.`,
        },
        tx
      );
      return cluster;
    });
  }

  static async updateCluster(
    clusterId: string,
    input: {
      label: string;
      anchor_time: string;
      intake_rule: IntakeConstraint;
      is_active?: boolean;
    },
    actor = "Consola Clinica Web"
  ): Promise<IntakeCluster> {
    const cluster = await withTransaction(async (tx) => {
      const pgTime = normalizePgTime(input.anchor_time);
      const res = await tx.query<IntakeCluster>(
        `UPDATE intake_clusters
         SET label = $2,
             anchor_time = $3::time,
             intake_rule = $4::intake_constraint,
             is_active = $5
         WHERE id = $1::uuid
         RETURNING id, label, anchor_time::text AS anchor_time, intake_rule, is_active`,
        [
          clusterId,
          input.label.trim(),
          pgTime,
          input.intake_rule,
          input.is_active ?? true,
        ]
      );
      const updated = res.rows[0];
      if (!updated) {
        throw new Error("Bloque horario no encontrado.");
      }

      await tx.query(
        `UPDATE medication_schedules
         SET effective_clustered_time = $2::time
         WHERE cluster_id = $1::uuid AND is_active = TRUE`,
        [clusterId, pgTime]
      );

      const todayStr = getClinicalDateParts("America/Mexico_City").dateStr;
      await tx.query(
        `UPDATE intake_logs
         SET scheduled_for = ((($2 || ' ' || $3)::timestamp) AT TIME ZONE 'America/Mexico_City')
         WHERE cluster_id = $1::uuid
           AND status = 'PENDING'
           AND (scheduled_for AT TIME ZONE 'America/Mexico_City')::date = $2::date`,
        [clusterId, todayStr, pgTime]
      );

      await GovernanceAuditService.log(
        {
          entity_type: "INTAKE_CLUSTER",
          entity_id: updated.id,
          entity_label: updated.label,
          action: "UPDATE",
          actor,
          summary: `Bloque horario "${updated.label}" actualizado a ${pgTime.slice(0, 5)} (${updated.intake_rule}).`,
        },
        tx
      );

      return updated;
    });

    await this.generateDailyIntakeLogsAndAlerts();
    return cluster;
  }

  static async deleteCluster(
    clusterId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    const affectedMedIds: string[] = [];
    const deleted = await withTransaction(async (tx) => {
      const medsRes = await tx.query<{ medication_id: string }>(
        `SELECT DISTINCT medication_id
         FROM medication_schedules
         WHERE cluster_id = $1::uuid AND is_active = TRUE`,
        [clusterId]
      );
      for (const r of medsRes.rows) {
        affectedMedIds.push(r.medication_id);
      }

      await tx.query(
        `UPDATE intake_logs SET cluster_id = NULL WHERE cluster_id = $1::uuid`,
        [clusterId]
      );

      const res = await tx.query<{ id: string; label: string }>(
        `DELETE FROM intake_clusters WHERE id = $1::uuid RETURNING id, label`,
        [clusterId]
      );
      const row = res.rows[0];
      if (!row) {
        throw new Error("Bloque horario no encontrado.");
      }

      await GovernanceAuditService.log(
        {
          entity_type: "INTAKE_CLUSTER",
          entity_id: row.id,
          entity_label: row.label,
          action: "DELETE",
          actor,
          summary: `Bloque horario "${row.label}" eliminado; medicamentos reasignados.`,
        },
        tx
      );
      return row;
    });

    for (const medId of affectedMedIds) {
      await this.optimizeMedicationSchedules(medId);
    }
    await this.generateDailyIntakeLogsAndAlerts();

    return { deletedId: deleted.id };
  }
}
