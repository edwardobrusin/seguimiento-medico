import { NextResponse } from "next/server";
import { z } from "zod";
import { DoseClusteringService } from "@/lib/services/dose-clustering.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const medPayloadFields = {
  name: z.string().min(1).max(150),
  active_ingredient: z.string().max(150).nullable().optional(),
  presentation: z.string().min(1).max(80),
  units_per_package: z.number().positive().nullable().optional(),
  package_price: z.number().min(0).nullable().optional(),
  dose_amount: z.number().positive(),
  current_stock: z.number().min(0).nullable().optional(),
  frequency_type: z.enum([
    "FIXED_HOURS",
    "DAILY_SLOTS",
    "INTERVAL_DAYS",
    "INTERVAL_WEEKS",
  ]),
  frequency_value: z.number().int().positive(),
  tolerance_window_mins: z.number().int().min(0).max(180).default(30),
  intake_rule: z
    .enum(["NONE", "FASTING", "WITH_FOOD", "SEPARATE_FROM_OTHERS"])
    .default("NONE"),
  preferred_pharmacy: z.string().max(150).nullable().optional(),
  purchase_priority: z.number().int().min(1).max(3).default(2),
  safety_buffer_days: z.number().int().min(1).max(60).default(7),
  clinical_notes: z.string().nullable().optional(),
  ideal_times: z.array(z.string()).optional(),
};

const medicationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate_today"),
    date_str: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    action: z.literal("create"),
    id: z.string().uuid().optional(),
    ...medPayloadFields,
  }),
  z.object({
    action: z.literal("update"),
    id: z.string().uuid(),
    ...medPayloadFields,
  }),
  z.object({
    action: z.literal("adjust_stock"),
    medication_id: z.string().uuid(),
    exact_stock: z.number().min(0).nullable(),
    reason: z.string().max(250).default("Conteo fisico manual"),
  }),
  z.object({
    action: z.literal("archive"),
    medication_id: z.string().uuid(),
    reason: z.string().max(300).nullable().optional(),
  }),
  z.object({
    action: z.literal("restore"),
    medication_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("delete"),
    medication_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("create_cluster"),
    label: z.string().min(1).max(80),
    anchor_time: z.string().min(4).max(8),
    intake_rule: z
      .enum(["NONE", "FASTING", "WITH_FOOD", "SEPARATE_FROM_OTHERS"])
      .default("NONE"),
  }),
  z.object({
    action: z.literal("update_cluster"),
    cluster_id: z.string().uuid(),
    label: z.string().min(1).max(80),
    anchor_time: z.string().min(4).max(8),
    intake_rule: z
      .enum(["NONE", "FASTING", "WITH_FOOD", "SEPARATE_FROM_OTHERS"])
      .default("NONE"),
    is_active: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("delete_cluster"),
    cluster_id: z.string().uuid(),
  }),
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = medicationActionSchema.parse(raw);

    if (parsed.action === "generate_today") {
      const result =
        await DoseClusteringService.generateDailyIntakeLogsAndAlerts(
          parsed.date_str
        );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "create" || parsed.action === "update") {
      const medication = await DoseClusteringService.createOrUpdateMedication({
        id: parsed.id,
        name: parsed.name,
        active_ingredient: parsed.active_ingredient ?? null,
        presentation: parsed.presentation,
        units_per_package: parsed.units_per_package ?? null,
        package_price: parsed.package_price ?? null,
        dose_amount: parsed.dose_amount,
        current_stock: parsed.current_stock ?? null,
        frequency_type: parsed.frequency_type,
        frequency_value: parsed.frequency_value,
        tolerance_window_mins: parsed.tolerance_window_mins,
        intake_rule: parsed.intake_rule,
        preferred_pharmacy: parsed.preferred_pharmacy ?? null,
        purchase_priority: parsed.purchase_priority,
        safety_buffer_days: parsed.safety_buffer_days,
        clinical_notes: parsed.clinical_notes ?? null,
        ideal_times: parsed.ideal_times,
      });
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, medication },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "adjust_stock") {
      const medication = await DoseClusteringService.adjustMedicationStock(
        parsed.medication_id,
        parsed.exact_stock,
        parsed.reason
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, medication },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "archive") {
      const medication = await DoseClusteringService.archiveMedication(
        parsed.medication_id,
        parsed.reason ?? null
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, medication },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "restore") {
      const medication = await DoseClusteringService.restoreMedication(
        parsed.medication_id
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, medication },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "delete") {
      const result = await DoseClusteringService.deleteMedicationPermanently(
        parsed.medication_id
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "create_cluster") {
      const cluster = await DoseClusteringService.createCluster({
        label: parsed.label,
        anchor_time: parsed.anchor_time,
        intake_rule: parsed.intake_rule,
      });
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, cluster },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "update_cluster") {
      const cluster = await DoseClusteringService.updateCluster(
        parsed.cluster_id,
        {
          label: parsed.label,
          anchor_time: parsed.anchor_time,
          intake_rule: parsed.intake_rule,
          is_active: parsed.is_active,
        }
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, cluster },
        { headers: NO_STORE_HEADERS }
      );
    }

    const result = await DoseClusteringService.deleteCluster(parsed.cluster_id);
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, ...result },
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
