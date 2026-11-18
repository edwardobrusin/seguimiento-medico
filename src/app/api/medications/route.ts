import { NextResponse } from "next/server";
import { z } from "zod";
import { DoseClusteringService } from "@/lib/services/dose-clustering.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const createMedSchema = z.object({
  action: z.enum(["create", "generate_today"]).default("create"),
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(150).optional(),
  active_ingredient: z.string().max(150).nullable().optional(),
  presentation: z.string().min(1).max(80).optional(),
  dose_amount: z.number().positive().optional(),
  current_stock: z.number().min(0).optional(),
  frequency_type: z
    .enum(["FIXED_HOURS", "DAILY_SLOTS", "INTERVAL_DAYS", "INTERVAL_WEEKS"])
    .optional(),
  frequency_value: z.number().int().positive().optional(),
  tolerance_window_mins: z.number().int().min(0).max(180).default(30),
  intake_rule: z
    .enum(["NONE", "FASTING", "WITH_FOOD", "SEPARATE_FROM_OTHERS"])
    .default("NONE"),
  clinical_notes: z.string().nullable().optional(),
  ideal_times: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = createMedSchema.parse(raw);

    if (parsed.action === "generate_today") {
      const result =
        await DoseClusteringService.generateDailyIntakeLogsAndAlerts();
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (
      !parsed.name ||
      !parsed.presentation ||
      !parsed.dose_amount ||
      !parsed.frequency_type ||
      !parsed.frequency_value
    ) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios del medicamento." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const medication = await DoseClusteringService.createOrUpdateMedication({
      id: parsed.id,
      name: parsed.name,
      active_ingredient: parsed.active_ingredient ?? null,
      presentation: parsed.presentation,
      dose_amount: parsed.dose_amount,
      current_stock: parsed.current_stock ?? 0,
      frequency_type: parsed.frequency_type,
      frequency_value: parsed.frequency_value,
      tolerance_window_mins: parsed.tolerance_window_mins,
      intake_rule: parsed.intake_rule,
      clinical_notes: parsed.clinical_notes ?? null,
      ideal_times: parsed.ideal_times,
    });

    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, medication },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error al procesar medicamento.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
