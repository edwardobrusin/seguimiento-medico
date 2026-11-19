import { NextResponse } from "next/server";
import { z } from "zod";
import { getActorLabel, requireAdmin, requireSession } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import { FinancialPlannerService } from "@/lib/services/financial-planner.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const expenseFields = {
  title: z.string().min(1).max(200),
  category: z.enum([
    "MEDICATION",
    "APPOINTMENT",
    "LAB_TEST",
    "IMAGING",
    "PROCEDURE",
    "THERAPY",
    "INSURANCE",
    "OTHER",
  ]),
  status: z.enum(["PAID", "PLANNED", "CANCELLED"]).default("PAID"),
  amount: z.number().min(0),
  expense_date: z.string().min(8),
  quincena_label: z.string().max(40).nullable().optional(),
  medication_id: z.string().uuid().nullable().optional(),
  clinical_event_id: z.string().uuid().nullable().optional(),
  packages_purchased: z.number().min(0).nullable().optional(),
  units_added: z.number().min(0).nullable().optional(),
  provider_or_pharmacy: z.string().max(150).nullable().optional(),
  payment_method: z.string().max(60).nullable().optional(),
  receipt_reference: z.string().max(120).nullable().optional(),
  notes: z.string().nullable().optional(),
};

const financesActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_settings"),
    currency: z.string().max(10).default("MXN"),
    pay_schedule_type: z.enum([
      "QUINCENAL_15_30",
      "QUINCENAL_1_15",
      "CUSTOM_DAYS",
      "CATORCENAL",
    ]),
    payday_1: z.number().int().min(1).max(31).default(15),
    payday_2: z.number().int().min(1).max(31).default(30),
    biweekly_anchor_date: z.string().nullable().optional(),
    quincenal_budget_cap: z.number().min(0).nullable().optional(),
    monthly_budget_cap: z.number().min(0).nullable().optional(),
    safety_buffer_days: z.number().int().min(1).max(60).default(7),
    planning_horizon_quincenas: z.number().int().min(2).max(12).default(6),
    include_events_in_plan: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("create_expense"),
    ...expenseFields,
  }),
  z.object({
    action: z.literal("update_expense"),
    expense_id: z.string().uuid(),
    ...expenseFields,
  }),
  z.object({
    action: z.literal("delete_expense"),
    expense_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("execute_planned_purchase"),
    medication_id: z.string().uuid(),
    packages: z.number().positive().default(1),
    units_override: z.number().positive().nullable().optional(),
    package_price: z.number().min(0).nullable().optional(),
    total_amount: z.number().min(0),
    purchase_date: z.string().optional(),
    quincena_label: z.string().max(40).nullable().optional(),
    provider_or_pharmacy: z.string().max(150).nullable().optional(),
    payment_method: z.string().max(60).nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = financesActionSchema.parse(raw);

    const session =
      body.action === "delete_expense"
        ? await requireAdmin()
        : await requireSession();
    const actor = getActorLabel(session);

    if (body.action === "update_settings") {
      const settings = await FinancialPlannerService.updateFinancialSettings(
        body,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, settings },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "create_expense") {
      const expense = await FinancialPlannerService.createExpense(body, actor);
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, expense },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "update_expense") {
      const expense = await FinancialPlannerService.updateExpense(
        body.expense_id,
        body,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, expense },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "delete_expense") {
      const result = await FinancialPlannerService.deleteExpense(
        body.expense_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    const result = await FinancialPlannerService.executePlannedPurchase(body, {
      role: session.role,
      actor,
    });
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const { status, message } = formatApiError(
      err,
      "Error en modulo financiero."
    );
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
