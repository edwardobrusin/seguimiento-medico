import { NextResponse } from "next/server";
import { z } from "zod";
import { DoseClusteringService } from "@/lib/services/dose-clustering.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const intakeActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm_cluster"),
    cluster_id: z.string().uuid(),
    date_str: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    recorded_by: z.string().min(1).max(100).default("Consola Clinica Web"),
  }),
  z.object({
    action: z.literal("confirm_single"),
    intake_log_id: z.string().uuid(),
    status: z.enum(["PENDING", "TAKEN", "DELAYED", "SKIPPED"]),
    recorded_by: z.string().min(1).max(100).default("Consola Clinica Web"),
    observations: z.string().optional(),
  }),
  z.object({
    action: z.literal("restock"),
    medication_id: z.string().uuid(),
    quantity: z.number().positive(),
  }),
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = intakeActionSchema.parse(raw);

    if (body.action === "confirm_cluster") {
      const result = await DoseClusteringService.confirmClusterIntake(
        body.cluster_id,
        body.date_str,
        body.recorded_by
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "confirm_single") {
      await DoseClusteringService.confirmSingleIntakeLog(
        body.intake_log_id,
        body.status,
        body.recorded_by,
        body.observations
      );
      safeRevalidateHome();
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }

    const medication = await DoseClusteringService.restockMedication(
      body.medication_id,
      body.quantity
    );
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, medication },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error al procesar confirmacion.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
