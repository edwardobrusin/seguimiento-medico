import { withTransaction } from "@/lib/db/client";
import type {
  ClinicalEventItem,
  EventCategory,
  ExpenseCategory,
} from "@/lib/types/clinical";
import { inferQuincenaLabel } from "./financial-planner.service";
import { GovernanceAuditService } from "./governance-audit.service";

export interface CreateClinicalEventInput {
  title: string;
  category: EventCategory;
  specialist_or_center?: string | null;
  location_address?: string | null;
  event_datetime: string;
  is_recurring: boolean;
  recurrence_interval_days?: number | null;
  medication_id?: string | null;
  preparation_instructions?: string | null;
  estimated_cost?: number | null;
  periodicity_label?: string | null;
  date_is_estimated?: boolean;
  notes?: string | null;
}

export interface UpdateClinicalEventInput extends CreateClinicalEventInput {
  actual_cost?: number | null;
}

export interface CompleteClinicalEventOptions {
  actual_cost?: number | null;
  notes?: string | null;
  log_expense?: boolean;
}

function toIsoStringSafe(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function mapEventCategoryToExpenseCategory(cat: EventCategory): ExpenseCategory {
  switch (cat) {
    case "APPOINTMENT":
      return "APPOINTMENT";
    case "INJECTION":
      return "MEDICATION";
    case "LAB_TEST":
      return "LAB_TEST";
    case "PROCEDURE":
      return "PROCEDURE";
    default:
      return "OTHER";
  }
}

export class ClinicalEventsService {
  static async createClinicalEvent(
    input: CreateClinicalEventInput,
    actor = "Consola Clinica Web"
  ): Promise<ClinicalEventItem> {
    return withTransaction(async (tx) => {
      const res = await tx.query<ClinicalEventItem>(
        `INSERT INTO clinical_events (
           title, category, specialist_or_center, location_address,
           event_datetime, is_recurring, recurrence_interval_days,
           medication_id, preparation_instructions,
           estimated_cost, periodicity_label, date_is_estimated, notes
         ) VALUES (
           $1, $2::event_category, $3, $4,
           $5::timestamptz, $6, $7,
           $8::uuid, $9,
           $10, $11, $12, $13
         )
         RETURNING *,
           estimated_cost::float8 AS estimated_cost,
           actual_cost::float8 AS actual_cost`,
        [
          input.title.trim(),
          input.category,
          input.specialist_or_center?.trim() || null,
          input.location_address?.trim() || null,
          input.event_datetime,
          input.is_recurring,
          input.is_recurring ? input.recurrence_interval_days ?? 21 : null,
          input.medication_id || null,
          input.preparation_instructions?.trim() || null,
          input.estimated_cost ?? null,
          input.periodicity_label?.trim() || null,
          input.date_is_estimated ?? false,
          input.notes?.trim() || null,
        ]
      );

      const created = res.rows[0];
      const createdEventIso = toIsoStringSafe(created.event_datetime);
      await tx.query(
        `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1::uuid, $2, $3, $4::timestamptz)`,
        [
          created.id,
          created.title,
          created.preparation_instructions ?? created.specialist_or_center ?? "",
          createdEventIso,
        ]
      );

      await GovernanceAuditService.log(
        {
          entity_type: "CLINICAL_EVENT",
          entity_id: created.id,
          entity_label: created.title,
          action: "CREATE",
          actor,
          summary: `Evento clinico "${created.title}" programado para ${createdEventIso.slice(0, 10)}.`,
        },
        tx
      );

      return {
        ...created,
        event_datetime: createdEventIso,
        medication_name: null,
        cascade_alerts: [],
      };
    });
  }

  static async updateClinicalEvent(
    eventId: string,
    input: UpdateClinicalEventInput,
    actor = "Consola Clinica Web"
  ): Promise<ClinicalEventItem> {
    return withTransaction(async (tx) => {
      const prevRes = await tx.query<ClinicalEventItem>(
        `SELECT *, estimated_cost::float8 AS estimated_cost, actual_cost::float8 AS actual_cost
         FROM clinical_events WHERE id = $1::uuid`,
        [eventId]
      );
      const prev = prevRes.rows[0];
      if (!prev) {
        throw new Error("Evento clinico no encontrado.");
      }

      const res = await tx.query<ClinicalEventItem>(
        `UPDATE clinical_events
         SET title = $2,
             category = $3::event_category,
             specialist_or_center = $4,
             location_address = $5,
             event_datetime = $6::timestamptz,
             is_recurring = $7,
             recurrence_interval_days = $8,
             medication_id = $9::uuid,
             preparation_instructions = $10,
             estimated_cost = $11,
             actual_cost = COALESCE($12, actual_cost),
             periodicity_label = $13,
             date_is_estimated = $14,
             notes = $15,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING *,
           estimated_cost::float8 AS estimated_cost,
           actual_cost::float8 AS actual_cost`,
        [
          eventId,
          input.title.trim(),
          input.category,
          input.specialist_or_center?.trim() || null,
          input.location_address?.trim() || null,
          input.event_datetime,
          input.is_recurring,
          input.is_recurring ? input.recurrence_interval_days ?? 21 : null,
          input.medication_id || null,
          input.preparation_instructions?.trim() || null,
          input.estimated_cost ?? null,
          input.actual_cost ?? null,
          input.periodicity_label?.trim() || null,
          input.date_is_estimated ?? false,
          input.notes?.trim() || null,
        ]
      );

      const updated = res.rows[0];
      const updatedEventIso = toIsoStringSafe(updated.event_datetime);

      if (!updated.is_completed) {
        await tx.query(
          `DELETE FROM notification_queue
           WHERE source_type = 'CLINICAL_EVENT'
             AND source_id = $1::uuid
             AND status = 'QUEUED'`,
          [eventId]
        );

        await tx.query(
          `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1::uuid, $2, $3, $4::timestamptz)`,
          [
            updated.id,
            updated.title,
            updated.preparation_instructions ?? updated.specialist_or_center ?? "",
            updatedEventIso,
          ]
        );
      }

      await GovernanceAuditService.log(
        {
          entity_type: "CLINICAL_EVENT",
          entity_id: updated.id,
          entity_label: updated.title,
          action: "UPDATE",
          actor,
          summary: `Evento clinico "${updated.title}" actualizado (fecha ${updatedEventIso.slice(0, 10)}).`,
        },
        tx
      );

      return {
        ...updated,
        event_datetime: updatedEventIso,
        medication_name: null,
        cascade_alerts: [],
      };
    });
  }

  static async rescheduleClinicalEvent(
    eventId: string,
    newDatetime: string,
    actor = "Consola Clinica Web"
  ): Promise<ClinicalEventItem> {
    return withTransaction(async (tx) => {
      const res = await tx.query<ClinicalEventItem>(
        `UPDATE clinical_events
         SET event_datetime = $2::timestamptz,
             date_is_estimated = FALSE,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING *,
           estimated_cost::float8 AS estimated_cost,
           actual_cost::float8 AS actual_cost`,
        [eventId, newDatetime]
      );

      const updated = res.rows[0];
      if (!updated) {
        throw new Error("Evento clinico no encontrado.");
      }
      const updatedEventIso = toIsoStringSafe(updated.event_datetime);

      await tx.query(
        `DELETE FROM notification_queue
         WHERE source_type = 'CLINICAL_EVENT'
           AND source_id = $1::uuid
           AND status = 'QUEUED'`,
        [eventId]
      );

      await tx.query(
        `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1::uuid, $2, $3, $4::timestamptz)`,
        [
          updated.id,
          updated.title,
          updated.preparation_instructions ?? updated.specialist_or_center ?? "",
          updatedEventIso,
        ]
      );

      await GovernanceAuditService.log(
        {
          entity_type: "CLINICAL_EVENT",
          entity_id: updated.id,
          entity_label: updated.title,
          action: "UPDATE",
          actor,
          summary: `Evento "${updated.title}" reprogramado para ${updatedEventIso.slice(0, 16)}.`,
        },
        tx
      );

      return {
        ...updated,
        event_datetime: updatedEventIso,
        medication_name: null,
        cascade_alerts: [],
      };
    });
  }

  static async completeClinicalEvent(
    eventId: string,
    recordedBy: string,
    options?: CompleteClinicalEventOptions
  ): Promise<{
    completedEventId: string;
    nextEventId: string | null;
    stockDeducted: boolean;
    expenseLogged: boolean;
  }> {
    return withTransaction(async (tx) => {
      const evtRes = await tx.query<ClinicalEventItem>(
        `UPDATE clinical_events
         SET is_completed = TRUE,
             completed_at = NOW(),
             actual_cost = COALESCE($2, actual_cost),
             notes = COALESCE($3, notes),
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING *,
           estimated_cost::float8 AS estimated_cost,
           actual_cost::float8 AS actual_cost`,
        [
          eventId,
          options?.actual_cost ?? null,
          options?.notes?.trim() || null,
        ]
      );

      const current = evtRes.rows[0];
      if (!current) {
        throw new Error("Evento clinico no encontrado.");
      }

      await tx.query(
        `UPDATE notification_queue
         SET status = 'ACKNOWLEDGED',
             acknowledged_at = NOW(),
             acknowledged_by_chat_id = $2
         WHERE source_type = 'CLINICAL_EVENT'
           AND source_id = $1::uuid
           AND status = 'QUEUED'`,
        [eventId, recordedBy]
      );

      let stockDeducted = false;
      if (current.medication_id) {
        const medRes = await tx.query<{ dose_amount: number }>(
          `SELECT dose_amount::float8 AS dose_amount
           FROM medications
           WHERE id = $1::uuid`,
          [current.medication_id]
        );
        const doseAmount = medRes.rows[0]?.dose_amount ?? 1;

        await tx.query(
          `INSERT INTO intake_logs (
             medication_id, scheduled_for, taken_at, status,
             quantity_deducted, recorded_by, observations
           ) VALUES (
             $1::uuid, $2::timestamptz, NOW(), 'TAKEN',
             $3, $4, $5
           )`,
          [
            current.medication_id,
            current.event_datetime,
            doseAmount,
            recordedBy,
            `Aplicacion confirmada desde evento clinico: ${current.title}`,
          ]
        );
        stockDeducted = true;
      }

      let expenseLogged = false;
      const effectiveCost = options?.actual_cost ?? current.actual_cost ?? current.estimated_cost;
      if (options?.log_expense && effectiveCost !== null && effectiveCost !== undefined && effectiveCost > 0) {
        const todayIso = new Date().toISOString().slice(0, 10);
        await tx.query(
          `INSERT INTO medical_expenses (
             title, category, status, amount, expense_date, quincena_label,
             clinical_event_id, medication_id, provider_or_pharmacy, notes
           ) VALUES (
             $1, $2::expense_category, 'PAID', $3, $4::date, $5,
             $6::uuid, $7::uuid, $8, $9
           )`,
          [
            current.title,
            mapEventCategoryToExpenseCategory(current.category),
            effectiveCost,
            todayIso,
            inferQuincenaLabel(todayIso),
            current.id,
            current.medication_id,
            current.specialist_or_center,
            options.notes?.trim() || current.notes || null,
          ]
        );
        expenseLogged = true;
      }

      let nextEventId: string | null = null;
      if (
        current.is_recurring &&
        current.recurrence_interval_days &&
        current.recurrence_interval_days > 0
      ) {
        const nextRes = await tx.query<{
          id: string;
          title: string;
          preparation_instructions: string | null;
          specialist_or_center: string | null;
          event_datetime: string;
        }>(
          `INSERT INTO clinical_events (
             title, category, specialist_or_center, location_address,
             event_datetime, is_recurring, recurrence_interval_days,
             medication_id, parent_event_id, preparation_instructions,
             estimated_cost, periodicity_label, date_is_estimated
           ) VALUES (
             $1, $2::event_category, $3, $4,
             $5::timestamptz + make_interval(days => $6::integer),
             TRUE, $6::integer,
             $7::uuid, $8::uuid, $9,
             $10, $11, $12
           )
           RETURNING id, title, preparation_instructions, specialist_or_center, event_datetime`,
          [
            current.title,
            current.category,
            current.specialist_or_center,
            current.location_address,
            current.event_datetime,
            current.recurrence_interval_days,
            current.medication_id,
            current.id,
            current.preparation_instructions,
            current.estimated_cost ?? null,
            current.periodicity_label ?? null,
            current.date_is_estimated ?? false,
          ]
        );

        const nextEvt = nextRes.rows[0];
        nextEventId = nextEvt.id;

        await tx.query(
          `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1::uuid, $2, $3, $4::timestamptz)`,
          [
            nextEvt.id,
            nextEvt.title,
            nextEvt.preparation_instructions ?? nextEvt.specialist_or_center ?? "",
            nextEvt.event_datetime,
          ]
        );
      }

      await GovernanceAuditService.log(
        {
          entity_type: "CLINICAL_EVENT",
          entity_id: current.id,
          entity_label: current.title,
          action: "COMPLETE",
          actor: recordedBy,
          summary: `Evento "${current.title}" marcado como realizado.${nextEventId ? " Siguiente ciclo generado." : ""}`,
        },
        tx
      );

      return {
        completedEventId: current.id,
        nextEventId,
        stockDeducted,
        expenseLogged,
      };
    });
  }

  static async reopenClinicalEvent(
    eventId: string,
    actor = "Consola Clinica Web"
  ): Promise<ClinicalEventItem> {
    return withTransaction(async (tx) => {
      const res = await tx.query<ClinicalEventItem>(
        `UPDATE clinical_events
         SET is_completed = FALSE,
             completed_at = NULL,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING *,
           estimated_cost::float8 AS estimated_cost,
           actual_cost::float8 AS actual_cost`,
        [eventId]
      );
      const evt = res.rows[0];
      if (!evt) {
        throw new Error("Evento clinico no encontrado.");
      }

      if (new Date(evt.event_datetime).getTime() > Date.now()) {
        await tx.query(
          `DELETE FROM notification_queue
           WHERE source_type = 'CLINICAL_EVENT'
             AND source_id = $1::uuid
             AND status = 'QUEUED'`,
          [eventId]
        );
        await tx.query(
          `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1::uuid, $2, $3, $4::timestamptz)`,
          [
            evt.id,
            evt.title,
            evt.preparation_instructions ?? evt.specialist_or_center ?? "",
            evt.event_datetime,
          ]
        );
      }

      await GovernanceAuditService.log(
        {
          entity_type: "CLINICAL_EVENT",
          entity_id: evt.id,
          entity_label: evt.title,
          action: "REOPEN",
          actor,
          summary: `Evento "${evt.title}" reabierto a estado programado.`,
        },
        tx
      );

      return { ...evt, medication_name: null, cascade_alerts: [] };
    });
  }

  static async deleteClinicalEvent(
    eventId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    return withTransaction(async (tx) => {
      await tx.query(
        `DELETE FROM notification_queue
         WHERE source_type = 'CLINICAL_EVENT'
           AND source_id = $1::uuid`,
        [eventId]
      );

      const res = await tx.query<{ id: string; title: string }>(
        `DELETE FROM clinical_events
         WHERE id = $1::uuid
         RETURNING id, title`,
        [eventId]
      );
      const deleted = res.rows[0];
      if (!deleted) {
        throw new Error("Evento clinico no encontrado.");
      }

      await GovernanceAuditService.log(
        {
          entity_type: "CLINICAL_EVENT",
          entity_id: deleted.id,
          entity_label: deleted.title,
          action: "DELETE",
          actor,
          summary: `Evento clinico "${deleted.title}" eliminado permanentemente.`,
        },
        tx
      );

      return { deletedId: deleted.id };
    });
  }
}
