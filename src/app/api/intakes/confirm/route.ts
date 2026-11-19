import { NextResponse } from "next/server";
import { z } from "zod";
import { getActorLabel, requireAdmin, requireSession } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import { DoseClusteringService } from "@/lib/services/dose-clustering.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const intakeActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm_cluster"),
    cluster_id: z.string().uuid(),
    date_str: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    recorded_by: z.string().min(1).max(100).optional(),
  }),
  z.object({
    action: z.literal("confirm_single"),
    intake_log_id: z.string().uuid(),
    status: z.enum(["PENDING", "TAKEN", "DELAYED", "SKIPPED"]),
    recorded_by: z.string().min(1).max(100).optional(),
    observations: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("delete_log"),
    intake_log_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("restock"),
    medication_id: z.string().uuid(),
    quantity: z.number().positive(),
    package_price: z.number().min(0).nullable().optional(),
    units_per_package: z.number().positive().nullable().optional(),
    expense_amount: z.number().min(0).nullable().optional(),
    provider_or_pharmacy: z.string().max(150).nullable().optional(),
    payment_method: z.string().max(60).nullable().optional(),
    log_expense: z.boolean().optional(),
  }),
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = intakeActionSchema.parse(raw);

    const session =
      body.action === "delete_log"
        ? await requireAdmin()
        : await requireSession();
    const actor = getActorLabel(session);

    if (body.action === "confirm_cluster") {
      const result = await DoseClusteringService.confirmClusterIntake(
        body.cluster_id,
        body.date_str,
        actor
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
        actor,
        body.observations
      );
      safeRevalidateHome();
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }

    if (body.action === "delete_log") {
      const result = await DoseClusteringService.deleteIntakeLog(
        body.intake_log_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    const medication = await DoseClusteringService.restockMedication(
      body.medication_id,
      body.quantity,
      actor,
      {
        origin: "WEB",
        role: session.role,
        package_price: body.package_price ?? null,
        units_per_package: body.units_per_package ?? null,
        expense_amount: body.expense_amount ?? null,
        provider_or_pharmacy: body.provider_or_pharmacy ?? null,
        payment_method: body.payment_method ?? null,
        log_expense: body.log_expense ?? false,
      }
    );
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, medication },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const { status, message } = formatApiError(
      err,
      "Error al procesar confirmacion."
    );
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
