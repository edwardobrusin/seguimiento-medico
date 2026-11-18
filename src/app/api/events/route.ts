import { NextResponse } from "next/server";
import { z } from "zod";
import { ClinicalEventsService } from "@/lib/services/clinical-events.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const eventActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().min(1).max(200),
    category: z.enum(["APPOINTMENT", "INJECTION", "LAB_TEST", "PROCEDURE", "OTHER"]),
    specialist_or_center: z.string().nullable().optional(),
    location_address: z.string().nullable().optional(),
    event_datetime: z.string().min(1),
    is_recurring: z.boolean().default(false),
    recurrence_interval_days: z.number().int().positive().nullable().optional(),
    medication_id: z.string().uuid().nullable().optional(),
    preparation_instructions: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("complete"),
    event_id: z.string().uuid(),
    recorded_by: z.string().min(1).max(100).default("Consola Clinica Web"),
  }),
  z.object({
    action: z.literal("reschedule"),
    event_id: z.string().uuid(),
    event_datetime: z.string().min(1),
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

    if (body.action === "complete") {
      const result = await ClinicalEventsService.completeClinicalEvent(
        body.event_id,
        body.recorded_by
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
