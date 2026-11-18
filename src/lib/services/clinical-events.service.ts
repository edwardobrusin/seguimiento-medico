import { withTransaction } from "@/lib/db/client";
import type { ClinicalEventItem, EventCategory } from "@/lib/types/clinical";

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
}

export class ClinicalEventsService {
  static async createClinicalEvent(
    input: CreateClinicalEventInput
  ): Promise<ClinicalEventItem> {
    return withTransaction(async (tx) => {
      const res = await tx.query<ClinicalEventItem>(
        `INSERT INTO clinical_events (
           title, category, specialist_or_center, location_address,
           event_datetime, is_recurring, recurrence_interval_days,
           medication_id, preparation_instructions
         ) VALUES (
           $1, $2::event_category, $3, $4,
           $5::timestamptz, $6, $7,
           $8, $9
         )
         RETURNING *`,
        [
          input.title,
          input.category,
          input.specialist_or_center ?? null,
          input.location_address ?? null,
          input.event_datetime,
          input.is_recurring,
          input.is_recurring ? input.recurrence_interval_days ?? 21 : null,
          input.medication_id ?? null,
          input.preparation_instructions ?? null,
        ]
      );

      const created = res.rows[0];
      await tx.query(
        `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1, $2, $3, $4::timestamptz)`,
        [
          created.id,
          created.title,
          created.preparation_instructions ?? created.specialist_or_center ?? "",
          created.event_datetime,
        ]
      );

      return { ...created, medication_name: null, cascade_alerts: [] };
    });
  }

  static async rescheduleClinicalEvent(
    eventId: string,
    newDatetime: string
  ): Promise<ClinicalEventItem> {
    return withTransaction(async (tx) => {
      const res = await tx.query<ClinicalEventItem>(
        `UPDATE clinical_events
         SET event_datetime = $2::timestamptz
         WHERE id = $1
         RETURNING *`,
        [eventId, newDatetime]
      );

      const updated = res.rows[0];
      if (!updated) {
        throw new Error("Evento clinico no encontrado.");
      }

      await tx.query(
        `DELETE FROM notification_queue
         WHERE source_type = 'CLINICAL_EVENT'
           AND source_id = $1
           AND status = 'QUEUED'`,
        [eventId]
      );

      await tx.query(
        `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1, $2, $3, $4::timestamptz)`,
        [
          updated.id,
          updated.title,
          updated.preparation_instructions ?? updated.specialist_or_center ?? "",
          updated.event_datetime,
        ]
      );

      return { ...updated, medication_name: null, cascade_alerts: [] };
    });
  }

  static async completeClinicalEvent(
    eventId: string,
    recordedBy: string
  ): Promise<{
    completedEventId: string;
    nextEventId: string | null;
    stockDeducted: boolean;
  }> {
    return withTransaction(async (tx) => {
      const evtRes = await tx.query<ClinicalEventItem>(
        `UPDATE clinical_events
         SET is_completed = TRUE,
             completed_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [eventId]
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
           AND source_id = $1
           AND status = 'QUEUED'`,
        [eventId, recordedBy]
      );

      let stockDeducted = false;
      if (current.medication_id) {
        const medRes = await tx.query<{ dose_amount: number }>(
          `SELECT dose_amount::float8 AS dose_amount
           FROM medications
           WHERE id = $1`,
          [current.medication_id]
        );
        const doseAmount = medRes.rows[0]?.dose_amount ?? 1;

        await tx.query(
          `INSERT INTO intake_logs (
             medication_id, scheduled_for, taken_at, status,
             quantity_deducted, recorded_by, observations
           ) VALUES (
             $1, $2::timestamptz, NOW(), 'TAKEN',
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
             medication_id, parent_event_id, preparation_instructions
           ) VALUES (
             $1, $2::event_category, $3, $4,
             $5::timestamptz + make_interval(days => $6::integer),
             TRUE, $6::integer,
             $7, $8, $9
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
          ]
        );

        const nextEvt = nextRes.rows[0];
        nextEventId = nextEvt.id;

        await tx.query(
          `SELECT fn_schedule_cascading_alerts('CLINICAL_EVENT', $1, $2, $3, $4::timestamptz)`,
          [
            nextEvt.id,
            nextEvt.title,
            nextEvt.preparation_instructions ?? nextEvt.specialist_or_center ?? "",
            nextEvt.event_datetime,
          ]
        );
      }

      return {
        completedEventId: current.id,
        nextEventId,
        stockDeducted,
      };
    });
  }
}
