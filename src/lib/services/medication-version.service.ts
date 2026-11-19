import { query, withTransaction, type DbExecutor } from "@/lib/db/client";
import { INTAKE_RULE_LABEL, FREQUENCY_TYPE_LABEL } from "@/lib/clinical-labels";
import {
  activeDaysEqual,
  calculateEffectiveDailyRate,
  formatActiveDaysLabel,
  normalizeActiveDays,
} from "@/lib/periodicity";
import { getClinicalDateParts } from "@/lib/utils";
import type {
  IntakeConstraint,
  MedFrequencyType,
  Medication,
  MedicationVersionFieldDiff,
  MedicationVersionItem,
  MedicationVersionSnapshotData,
} from "@/lib/types/clinical";
import { GovernanceAuditService } from "./governance-audit.service";

type QueryExecutor = Pick<DbExecutor, "query">;

export interface VersionActorContext {
  role: "ADMIN" | "PATIENT" | "SYSTEM";
  actor: string;
}

interface RawMedRow {
  id: string;
  name: string;
  active_ingredient: string | null;
  presentation: string;
  units_per_package: number | null;
  package_price: number | null;
  dose_amount: number;
  current_stock: number | null;
  frequency_type: MedFrequencyType;
  frequency_value: number;
  tolerance_window_mins: number;
  intake_rule: IntakeConstraint;
  active_days: unknown;
  schedule_start_date: string | null;
  daily_consumption_rate: number;
  preferred_pharmacy: string | null;
  purchase_priority: number;
  safety_buffer_days: number;
  clinical_notes: string | null;
  is_active: boolean;
  archived_at: string | null;
  discontinuation_reason: string | null;
}

interface RawScheduleRow {
  cluster_id: string | null;
  cluster_label: string | null;
  ideal_time: string;
  effective_clustered_time: string;
  day_of_week: number | null;
}

function formatMoneyOrNull(val: number | null | undefined): string {
  if (val === null || val === undefined) return "Pendiente";
  return `$${Number(val).toFixed(2)} MXN`;
}

function formatNumOrNull(val: number | null | undefined): string {
  if (val === null || val === undefined) return "Pendiente";
  return String(val);
}

function formatSchedulesSummary(
  schedules: MedicationVersionSnapshotData["schedules"]
): string {
  if (!schedules || schedules.length === 0) {
    return "Sin horarios diarios (vinculado a evento)";
  }
  return schedules
    .map(
      (s) =>
        `${s.effective_clustered_time.slice(0, 5)}${
          s.cluster_label ? ` (${s.cluster_label})` : ""
        }`
    )
    .join(", ");
}

function parseSnapshotJson(raw: unknown): MedicationVersionSnapshotData {
  if (typeof raw === "string") {
    return JSON.parse(raw) as MedicationVersionSnapshotData;
  }
  return raw as MedicationVersionSnapshotData;
}

export class MedicationVersionService {
  static async buildMedicationSnapshot(
    medicationId: string,
    executor: QueryExecutor = { query }
  ): Promise<MedicationVersionSnapshotData | null> {
    const medRes = await executor.query<RawMedRow>(
      `SELECT
         id, name, active_ingredient, presentation,
         units_per_package::float8 AS units_per_package,
         package_price::float8 AS package_price,
         dose_amount::float8 AS dose_amount,
         current_stock::float8 AS current_stock,
         frequency_type, frequency_value, tolerance_window_mins, intake_rule,
         active_days,
         schedule_start_date::text AS schedule_start_date,
         daily_consumption_rate::float8 AS daily_consumption_rate,
         preferred_pharmacy, purchase_priority, safety_buffer_days,
         clinical_notes, is_active,
         archived_at::text AS archived_at,
         discontinuation_reason
       FROM medications
       WHERE id = $1::uuid
       LIMIT 1`,
      [medicationId]
    );
    const m = medRes.rows[0];
    if (!m) return null;

    const schRes = await executor.query<RawScheduleRow>(
      `SELECT
         ms.cluster_id,
         ic.label AS cluster_label,
         ms.ideal_time::text AS ideal_time,
         ms.effective_clustered_time::text AS effective_clustered_time,
         ms.day_of_week
       FROM medication_schedules ms
       LEFT JOIN intake_clusters ic ON ic.id = ms.cluster_id
       WHERE ms.medication_id = $1::uuid
         AND ms.is_active = TRUE
       ORDER BY ms.effective_clustered_time ASC`,
      [medicationId]
    );

    return {
      name: m.name,
      active_ingredient: m.active_ingredient,
      presentation: m.presentation,
      units_per_package: m.units_per_package,
      package_price: m.package_price,
      dose_amount: m.dose_amount,
      current_stock: m.current_stock,
      frequency_type: m.frequency_type,
      frequency_value: m.frequency_value,
      tolerance_window_mins: m.tolerance_window_mins,
      intake_rule: m.intake_rule,
      active_days: normalizeActiveDays(m.active_days as number[] | null),
      schedule_start_date: m.schedule_start_date,
      daily_consumption_rate: m.daily_consumption_rate,
      preferred_pharmacy: m.preferred_pharmacy,
      purchase_priority: m.purchase_priority,
      safety_buffer_days: m.safety_buffer_days,
      clinical_notes: m.clinical_notes,
      is_active: m.is_active,
      archived_at: m.archived_at,
      discontinuation_reason: m.discontinuation_reason,
      schedules: schRes.rows.map((s) => ({
        cluster_id: s.cluster_id,
        cluster_label: s.cluster_label,
        ideal_time: s.ideal_time,
        effective_clustered_time: s.effective_clustered_time,
        day_of_week: s.day_of_week,
      })),
    };
  }

  static computeFieldDiff(
    before: MedicationVersionSnapshotData | null,
    after: MedicationVersionSnapshotData
  ): MedicationVersionFieldDiff[] {
    if (!before) return [];
    const diffs: MedicationVersionFieldDiff[] = [];

    const check = (
      field: string,
      label: string,
      prevVal: string,
      nextVal: string
    ) => {
      if (prevVal !== nextVal) {
        diffs.push({ field, label, before: prevVal, after: nextVal });
      }
    };

    check("name", "Nombre", before.name, after.name);
    check(
      "active_ingredient",
      "Principio activo",
      before.active_ingredient ?? "Ninguno",
      after.active_ingredient ?? "Ninguno"
    );
    check("presentation", "Presentacion", before.presentation, after.presentation);
    check(
      "dose_amount",
      "Dosis por toma",
      String(before.dose_amount),
      String(after.dose_amount)
    );
    check(
      "frequency",
      "Periodicidad",
      `${FREQUENCY_TYPE_LABEL[before.frequency_type]} (${before.frequency_value})`,
      `${FREQUENCY_TYPE_LABEL[after.frequency_type]} (${after.frequency_value})`
    );
    if (!activeDaysEqual(before.active_days, after.active_days)) {
      diffs.push({
        field: "active_days",
        label: "Dias de la semana",
        before: formatActiveDaysLabel(before.active_days),
        after: formatActiveDaysLabel(after.active_days),
      });
    }
    check(
      "schedule_start_date",
      "Fecha de inicio ciclo",
      before.schedule_start_date ?? "Automatica",
      after.schedule_start_date ?? "Automatica"
    );
    check(
      "intake_rule",
      "Regla de ingesta",
      INTAKE_RULE_LABEL[before.intake_rule],
      INTAKE_RULE_LABEL[after.intake_rule]
    );
    check(
      "tolerance_window_mins",
      "Ventana de tolerancia",
      `${before.tolerance_window_mins} min`,
      `${after.tolerance_window_mins} min`
    );
    check(
      "current_stock",
      "Stock actual",
      formatNumOrNull(before.current_stock),
      formatNumOrNull(after.current_stock)
    );
    check(
      "units_per_package",
      "Unidades por envase",
      formatNumOrNull(before.units_per_package),
      formatNumOrNull(after.units_per_package)
    );
    check(
      "package_price",
      "Precio por envase",
      formatMoneyOrNull(before.package_price),
      formatMoneyOrNull(after.package_price)
    );
    check(
      "preferred_pharmacy",
      "Farmacia habitual",
      before.preferred_pharmacy ?? "Sin definir",
      after.preferred_pharmacy ?? "Sin definir"
    );
    check(
      "purchase_priority",
      "Prioridad de compra",
      String(before.purchase_priority),
      String(after.purchase_priority)
    );
    check(
      "safety_buffer_days",
      "Colchon seguridad",
      `${before.safety_buffer_days} dias`,
      `${after.safety_buffer_days} dias`
    );
    check(
      "clinical_notes",
      "Notas clinicas",
      before.clinical_notes ?? "Sin notas",
      after.clinical_notes ?? "Sin notas"
    );
    check(
      "is_active",
      "Estado",
      before.is_active ? "Activo" : "Archivado",
      after.is_active ? "Activo" : "Archivado"
    );
    check(
      "schedules",
      "Horarios asignados",
      formatSchedulesSummary(before.schedules),
      formatSchedulesSummary(after.schedules)
    );

    return diffs;
  }

  static async ensureBaselineVersion(
    medicationId: string,
    snapshotBeforeMutation: MedicationVersionSnapshotData | null,
    executor: QueryExecutor = { query }
  ): Promise<void> {
    if (!snapshotBeforeMutation) return;
    const countRes = await executor.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM medication_versions
       WHERE medication_id = $1::uuid`,
      [medicationId]
    );
    if (Number(countRes.rows[0]?.count ?? "0") > 0) {
      return;
    }

    await executor.query(
      `INSERT INTO medication_versions (
         medication_id, version_number, change_action,
         changed_by_role, changed_by_actor, change_summary,
         changed_fields, snapshot_json, reviewed_by_admin, reviewed_at
       ) VALUES (
         $1::uuid, 1, 'INITIAL_BASELINE',
         'SYSTEM', 'Sistema', 'Version base inicial previa a modificaciones.',
         '[]'::jsonb, $2::jsonb, TRUE, NOW()
       )`,
      [medicationId, JSON.stringify(snapshotBeforeMutation)]
    );
  }

  static async recordMedicationVersion(
    params: {
      medicationId: string;
      action: string;
      context: VersionActorContext;
      summary: string;
      beforeSnapshot: MedicationVersionSnapshotData | null;
      afterSnapshot: MedicationVersionSnapshotData;
    },
    executor: QueryExecutor = { query }
  ): Promise<MedicationVersionItem> {
    const nextRes = await executor.query<{ next_ver: number }>(
      `SELECT (COALESCE(MAX(version_number), 0) + 1)::int AS next_ver
       FROM medication_versions
       WHERE medication_id = $1::uuid`,
      [params.medicationId]
    );
    const nextVersion = nextRes.rows[0]?.next_ver ?? 1;
    const diffs = this.computeFieldDiff(
      params.beforeSnapshot,
      params.afterSnapshot
    );
    const reviewedByAdmin = params.context.role !== "PATIENT";

    const insRes = await executor.query<MedicationVersionItem>(
      `INSERT INTO medication_versions (
         medication_id, version_number, change_action,
         changed_by_role, changed_by_actor, change_summary,
         changed_fields, snapshot_json, reviewed_by_admin, reviewed_at
       ) VALUES (
         $1::uuid, $2, $3,
         $4, $5, $6,
         $7::jsonb, $8::jsonb, $9, CASE WHEN $9 THEN NOW() ELSE NULL END
       )
       RETURNING *`,
      [
        params.medicationId,
        nextVersion,
        params.action,
        params.context.role,
        params.context.actor.slice(0, 120),
        params.summary,
        JSON.stringify(diffs),
        JSON.stringify(params.afterSnapshot),
        reviewedByAdmin,
      ]
    );

    const createdVersion = insRes.rows[0];

    // Notificar a administradores en Telegram si el cambio provino del paciente y la regla esta activa
    if (params.context.role === "PATIENT") {
      const settingsRes = await executor.query<{
        notify_admin_on_patient_change: boolean;
      }>(
        `SELECT notify_admin_on_patient_change
         FROM alert_monitoring_settings
         WHERE id = 1
         LIMIT 1`
      );
      const notifyEnabled =
        settingsRes.rows[0]?.notify_admin_on_patient_change ?? true;

      if (notifyEnabled) {
        const diffLines =
          diffs.length > 0
            ? diffs
                .slice(0, 6)
                .map(
                  (d) =>
                    `- ${d.label}: ${d.before} -> ${d.after}`
                )
                .join("\n")
            : `- ${params.summary}`;
        const msg = [
          `<b>[CAMBIO REGISTRADO POR PACIENTE]</b>`,
          `Medicamento: <b>${params.afterSnapshot.name}</b> (Version v${nextVersion})`,
          `Origen: ${params.context.actor}`,
          "----------------------------------------",
          diffLines,
          "----------------------------------------",
          "Puedes revisar este cambio o restaurar la version anterior desde Inventario (Historial) en el panel web.",
        ].join("\n");

        await executor.query(
          `INSERT INTO notification_queue (
             source_type, source_id, stage, trigger_at, status,
             title, message, callback_action_payload, idempotency_key
           ) VALUES (
             'PATIENT_CHANGE_ALERT', $1::uuid, 'EXACT_TIME', NOW(), 'QUEUED',
             $2, $3, $4, $5
           ) ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            params.medicationId,
            `[CAMBIO DE PACIENTE] ${params.afterSnapshot.name} (v${nextVersion})`,
            msg,
            `ack_change:${createdVersion.id}`,
            `PATIENT_CHG_${createdVersion.id}`,
          ]
        );
      }
    }

    return createdVersion;
  }

  static async listVersionsForMedication(
    medicationId: string
  ): Promise<MedicationVersionItem[]> {
    const res = await query<MedicationVersionItem>(
      `SELECT mv.*, m.name AS medication_name
       FROM medication_versions mv
       JOIN medications m ON m.id = mv.medication_id
       WHERE mv.medication_id = $1::uuid
       ORDER BY mv.version_number DESC`,
      [medicationId]
    );
    return res.rows;
  }

  static async markVersionReviewed(
    versionId: string,
    adminActor: string
  ): Promise<MedicationVersionItem> {
    const res = await query<MedicationVersionItem>(
      `UPDATE medication_versions
       SET reviewed_by_admin = TRUE,
           reviewed_at = NOW()
       WHERE id = $1::uuid
       RETURNING *`,
      [versionId]
    );
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Version de medicamento no encontrada.");
    }
    await GovernanceAuditService.log({
      entity_type: "MEDICATION_VERSION",
      entity_id: updated.id,
      entity_label: `v${updated.version_number}`,
      action: "UPDATE",
      actor: adminActor,
      summary: `Cambio v${updated.version_number} revisado y aprobado por administrador.`,
    });
    return updated;
  }

  static async restoreMedicationVersion(
    medicationId: string,
    versionId: string,
    adminActor: string
  ): Promise<{ medication: Medication; restoredVersion: MedicationVersionItem }> {
    const restored = await withTransaction(async (tx) => {
      const targetRes = await tx.query<{
        id: string;
        version_number: number;
        snapshot_json: unknown;
      }>(
        `SELECT id, version_number, snapshot_json
         FROM medication_versions
         WHERE id = $1::uuid AND medication_id = $2::uuid
         LIMIT 1`,
        [versionId, medicationId]
      );
      const targetRow = targetRes.rows[0];
      if (!targetRow) {
        throw new Error("La version solicitada no existe para este medicamento.");
      }

      const targetSnap = parseSnapshotJson(targetRow.snapshot_json);
      const beforeSnap = await this.buildMedicationSnapshot(medicationId, tx);
      if (!beforeSnap) {
        throw new Error("Medicamento no encontrado.");
      }

      const activeDays = normalizeActiveDays(targetSnap.active_days);
      const dailyRate = calculateEffectiveDailyRate(
        targetSnap.dose_amount,
        targetSnap.frequency_type,
        targetSnap.frequency_value,
        activeDays
      );

      const medUpdateRes = await tx.query<Medication>(
        `UPDATE medications
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
             is_active = $20,
             archived_at = $21::timestamptz,
             discontinuation_reason = $22,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING
           *,
           units_per_package::float8 AS units_per_package,
           package_price::float8 AS package_price,
           dose_amount::float8 AS dose_amount,
           current_stock::float8 AS current_stock,
           schedule_start_date::text AS schedule_start_date,
           daily_consumption_rate::float8 AS daily_consumption_rate,
           days_of_supply_remaining::float8 AS days_of_supply_remaining`,
        [
          medicationId,
          targetSnap.name,
          targetSnap.active_ingredient,
          targetSnap.presentation,
          targetSnap.units_per_package,
          targetSnap.package_price,
          targetSnap.dose_amount,
          targetSnap.current_stock,
          targetSnap.frequency_type,
          targetSnap.frequency_value,
          targetSnap.tolerance_window_mins,
          targetSnap.intake_rule,
          activeDays ? JSON.stringify(activeDays) : null,
          targetSnap.schedule_start_date || null,
          dailyRate,
          targetSnap.preferred_pharmacy,
          targetSnap.purchase_priority ?? 2,
          targetSnap.safety_buffer_days ?? 7,
          targetSnap.clinical_notes,
          targetSnap.is_active ?? true,
          targetSnap.archived_at ?? null,
          targetSnap.discontinuation_reason ?? null,
        ]
      );
      const updatedMed = medUpdateRes.rows[0];

      // Restaurar schedules exactos de esa version (validando que clusters sigan existiendo)
      await tx.query(
        `UPDATE medication_schedules SET is_active = FALSE WHERE medication_id = $1::uuid`,
        [medicationId]
      );

      for (const sch of targetSnap.schedules ?? []) {
        let validClusterId: string | null = null;
        if (sch.cluster_id) {
          const clRes = await tx.query<{ id: string }>(
            `SELECT id FROM intake_clusters WHERE id = $1::uuid AND is_active = TRUE LIMIT 1`,
            [sch.cluster_id]
          );
          validClusterId = clRes.rows[0]?.id ?? null;
        }
        await tx.query(
          `INSERT INTO medication_schedules (
             medication_id, cluster_id, ideal_time, effective_clustered_time, day_of_week, is_active
           ) VALUES ($1::uuid, $2::uuid, $3::time, $4::time, $5, TRUE)`,
          [
            medicationId,
            validClusterId,
            sch.ideal_time,
            sch.effective_clustered_time,
            sch.day_of_week ?? null,
          ]
        );
      }

      // Limpiar tomas pendientes de hoy en Mexico para reflejar inmediatamente la version restaurada
      const todayStr = getClinicalDateParts("America/Mexico_City").dateStr;
      await tx.query(
        `DELETE FROM intake_logs
         WHERE medication_id = $1::uuid
           AND status = 'PENDING'
           AND (scheduled_for AT TIME ZONE 'America/Mexico_City')::date = $2::date`,
        [medicationId, todayStr]
      );

      // Marcar versiones previas sin revisar como revisadas ya que el admin intervino
      await tx.query(
        `UPDATE medication_versions
         SET reviewed_by_admin = TRUE,
             reviewed_at = COALESCE(reviewed_at, NOW())
         WHERE medication_id = $1::uuid
           AND reviewed_by_admin = FALSE`,
        [medicationId]
      );

      const afterSnap =
        (await this.buildMedicationSnapshot(medicationId, tx)) ?? targetSnap;

      const newVer = await this.recordMedicationVersion(
        {
          medicationId,
          action: "VERSION_RESTORE",
          context: { role: "ADMIN", actor: adminActor },
          summary: `Restaurado a la version v${targetRow.version_number} por ${adminActor}.`,
          beforeSnapshot: beforeSnap,
          afterSnapshot: afterSnap,
        },
        tx
      );

      await GovernanceAuditService.log(
        {
          entity_type: "MEDICATION",
          entity_id: updatedMed.id,
          entity_label: updatedMed.name,
          action: "VERSION_RESTORE",
          actor: adminActor,
          summary: `"${updatedMed.name}" restaurado a la version v${targetRow.version_number}.`,
        },
        tx
      );

      return { medication: updatedMed, restoredVersion: newVer };
    });

    const { DoseClusteringService } = await import("./dose-clustering.service");
    await DoseClusteringService.generateDailyIntakeLogsAndAlerts();

    return restored;
  }
}
