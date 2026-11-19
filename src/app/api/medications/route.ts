import { NextResponse } from "next/server";
import { z } from "zod";
import { getActorLabel, requireAdmin, requireSession } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import { DoseClusteringService } from "@/lib/services/dose-clustering.service";
import { MedicationVersionService } from "@/lib/services/medication-version.service";
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
  active_days: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  schedule_start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  preferred_pharmacy: z.string().max(150).nullable().optional(),
  purchase_priority: z.number().int().min(1).max(3).default(2),
  safety_buffer_days: z.number().int().min(1).max(60).default(7),
  clinical_notes: z.string().nullable().optional(),
  ideal_times: z.array(z.string()).optional(),
  event_linked_only: z.boolean().optional(),
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
    action: z.literal("list_versions"),
    medication_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("mark_version_reviewed"),
    version_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("restore_version"),
    medication_id: z.string().uuid(),
    version_id: z.string().uuid(),
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

const ADMIN_ONLY_MED_ACTIONS = new Set([
  "delete",
  "archive",
  "restore",
  "delete_cluster",
  "list_versions",
  "mark_version_reviewed",
  "restore_version",
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = medicationActionSchema.parse(raw);

    const session = ADMIN_ONLY_MED_ACTIONS.has(parsed.action)
      ? await requireAdmin()
      : await requireSession();
    const actor = getActorLabel(session);
    const ctx = { role: session.role, actor };

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
      const medication = await DoseClusteringService.createOrUpdateMedication(
        {
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
          active_days: parsed.active_days ?? null,
          schedule_start_date: parsed.schedule_start_date ?? null,
          preferred_pharmacy: parsed.preferred_pharmacy ?? null,
          purchase_priority: parsed.purchase_priority,
          safety_buffer_days: parsed.safety_buffer_days,
          clinical_notes: parsed.clinical_notes ?? null,
          ideal_times: parsed.ideal_times,
          event_linked_only: parsed.event_linked_only,
        },
        ctx
      );
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
        parsed.reason,
        ctx
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
        parsed.reason ?? null,
        ctx
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, medication },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "restore") {
      const medication = await DoseClusteringService.restoreMedication(
        parsed.medication_id,
        ctx
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, medication },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "delete") {
      const result = await DoseClusteringService.deleteMedicationPermanently(
        parsed.medication_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "list_versions") {
      const versions = await MedicationVersionService.listVersionsForMedication(
        parsed.medication_id
      );
      return NextResponse.json(
        { ok: true, versions },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "mark_version_reviewed") {
      const version = await MedicationVersionService.markVersionReviewed(
        parsed.version_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, version },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "restore_version") {
      const result = await MedicationVersionService.restoreMedicationVersion(
        parsed.medication_id,
        parsed.version_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.action === "create_cluster") {
      const cluster = await DoseClusteringService.createCluster(
        {
          label: parsed.label,
          anchor_time: parsed.anchor_time,
          intake_rule: parsed.intake_rule,
        },
        actor
      );
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
        },
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, cluster },
        { headers: NO_STORE_HEADERS }
      );
    }

    const result = await DoseClusteringService.deleteCluster(
      parsed.cluster_id,
      actor
    );
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const { status, message } = formatApiError(
      err,
      "Error al procesar medicamento."
    );
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
