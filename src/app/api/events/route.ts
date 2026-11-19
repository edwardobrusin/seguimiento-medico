import { NextResponse } from "next/server";
import { z } from "zod";
import { ClinicalEventsService } from "@/lib/services/clinical-events.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const eventFields = {
  title: z.string().min(1).max(200),
  category: z.enum(["APPOINTMENT", "INJECTION", "LAB_TEST", "PROCEDURE", "OTHER"]),
  specialist_or_center: z.string().nullable().optional(),
  location_address: z.string().nullable().optional(),
  event_datetime: z.string().min(1),
  is_recurring: z.boolean().default(false),
  recurrence_interval_days: z.number().int().positive().nullable().optional(),
  medication_id: z.string().uuid().nullable().optional(),
  preparation_instructions: z.string().nullable().optional(),
  estimated_cost: z.number().min(0).nullable().optional(),
  periodicity_label: z.string().max(80).nullable().optional(),
  date_is_estimated: z.boolean().default(false),
  notes: z.string().nullable().optional(),
};

const eventActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    ...eventFields,
  }),
  z.object({
    action: z.literal("update"),
    event_id: z.string().uuid(),
    actual_cost: z.number().min(0).nullable().optional(),
    ...eventFields,
  }),
  z.object({
    action: z.literal("complete"),
    event_id: z.string().uuid(),
    recorded_by: z.string().min(1).max(100).default("Consola Clinica Web"),
    actual_cost: z.number().min(0).nullable().optional(),
    notes: z.string().nullable().optional(),
    log_expense: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("reschedule"),
    event_id: z.string().uuid(),
    event_datetime: z.string().min(1),
  }),
  z.object({
    action: z.literal("reopen"),
    event_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("delete"),
    event_id: z.string().uuid(),
  }),
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = eventActionSchema.parse(raw);

    if (body.action === "create") {
      const event = await ClinicalEventsService.createClinicalEvent(body);
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, event },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "update") {
      const event = await ClinicalEventsService.updateClinicalEvent(
        body.event_id,
        body
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, event },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "complete") {
      const result = await ClinicalEventsService.completeClinicalEvent(
        body.event_id,
        body.recorded_by,
        {
          actual_cost: body.actual_cost ?? null,
          notes: body.notes ?? null,
          log_expense: body.log_expense,
        }
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "reopen") {
      const event = await ClinicalEventsService.reopenClinicalEvent(
        body.event_id
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, event },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "delete") {
      const result = await ClinicalEventsService.deleteClinicalEvent(
        body.event_id
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    const event = await ClinicalEventsService.rescheduleClinicalEvent(
      body.event_id,
      body.event_datetime
    );
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, event },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error al procesar evento clinico.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
