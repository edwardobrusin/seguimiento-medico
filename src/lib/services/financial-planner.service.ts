import { query, withTransaction } from "@/lib/db/client";
import type {
  ClinicalEventItem,
  ExpenseCategory,
  ExpenseStatus,
  FinancialOptimizationSummary,
  FinancialPlanSnapshot,
  FinancialSettings,
  MedicalExpense,
  Medication,
  PayScheduleType,
  PlannedEventExpense,
  PlannedMedicationPurchase,
  QuincenaPlanBucket,
  ReserveAlertItem,
} from "@/lib/types/clinical";
import { GovernanceAuditService } from "./governance-audit.service";

const MONTH_ABBR = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

export const DEFAULT_FINANCIAL_SETTINGS: FinancialSettings = {
  id: 1,
  currency: "MXN",
  pay_schedule_type: "QUINCENAL_15_30",
  payday_1: 15,
  payday_2: 30,
  biweekly_anchor_date: null,
  quincenal_budget_cap: null,
  monthly_budget_cap: null,
  safety_buffer_days: 7,
  planning_horizon_quincenas: 6,
  include_events_in_plan: true,
  updated_at: new Date().toISOString(),
};

export interface UpdateFinancialSettingsInput {
  currency?: string;
  pay_schedule_type: PayScheduleType;
  payday_1: number;
  payday_2: number;
  biweekly_anchor_date?: string | null;
  quincenal_budget_cap?: number | null;
  monthly_budget_cap?: number | null;
  safety_buffer_days: number;
  planning_horizon_quincenas: number;
  include_events_in_plan: boolean;
}

export interface CreateExpenseInput {
  title: string;
  category: ExpenseCategory;
  status?: ExpenseStatus;
  amount: number;
  expense_date: string;
  quincena_label?: string | null;
  medication_id?: string | null;
  clinical_event_id?: string | null;
  packages_purchased?: number | null;
  units_added?: number | null;
  provider_or_pharmacy?: string | null;
  payment_method?: string | null;
  receipt_reference?: string | null;
  notes?: string | null;
}

export interface ExecutePlannedPurchaseInput {
  medication_id: string;
  packages: number;
  units_override?: number | null;
  package_price?: number | null;
  total_amount: number;
  purchase_date?: string;
  quincena_label?: string | null;
  provider_or_pharmacy?: string | null;
  payment_method?: string | null;
  notes?: string | null;
}

function toIsoStringSafe(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseUtcDate(isoDate: string): Date {
  const clean = isoDate.slice(0, 10);
  const [y, m, d] = clean.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0));
}

function addDaysIso(isoDate: string, days: number): string {
  const dt = parseUtcDate(isoDate);
  dt.setUTCDate(dt.getUTCDate() + Math.round(days));
  return toIsoDate(dt);
}

function diffDaysIso(fromIso: string, toIso: string): number {
  const a = parseUtcDate(fromIso).getTime();
  const b = parseUtcDate(toIso).getTime();
  return Math.round((b - a) / 86400000);
}

function formatShortDateEs(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const monthLabel = MONTH_ABBR[(m || 1) - 1] ?? "Mes";
  return `${String(d).padStart(2, "0")} ${monthLabel} ${y}`;
}

export function inferQuincenaLabel(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const monthLabel = MONTH_ABBR[(m || 1) - 1] ?? "Mes";
  return d <= 15 ? `Q1 ${monthLabel} ${y}` : `Q2 ${monthLabel} ${y}`;
}

function generatePaydayBuckets(
  settings: FinancialSettings,
  refIsoDate: string
): QuincenaPlanBucket[] {
  const horizon = Math.max(2, Math.min(12, settings.planning_horizon_quincenas || 6));
  const payDates: string[] = [];

  if (settings.pay_schedule_type === "CATORCENAL") {
    let cursor = settings.biweekly_anchor_date
      ? settings.biweekly_anchor_date.slice(0, 10)
      : refIsoDate;
    let guard = 0;
    while (cursor < refIsoDate && guard < 200) {
      cursor = addDaysIso(cursor, 14);
      guard += 1;
    }
    while (diffDaysIso(refIsoDate, cursor) >= 14) {
      cursor = addDaysIso(cursor, -14);
    }
    if (cursor < refIsoDate) {
      cursor = addDaysIso(cursor, 14);
    }
    for (let i = 0; i < horizon + 1; i += 1) {
      payDates.push(addDaysIso(cursor, i * 14));
    }
  } else {
    let rawD1 = 15;
    let rawD2 = 30;
    if (settings.pay_schedule_type === "QUINCENAL_1_15") {
      rawD1 = 1;
      rawD2 = 15;
    } else if (settings.pay_schedule_type === "CUSTOM_DAYS") {
      rawD1 = Math.max(1, Math.min(31, settings.payday_1 || 15));
      rawD2 = Math.max(1, Math.min(31, settings.payday_2 || 30));
    }
    const [dMin, dMax] = rawD1 <= rawD2 ? [rawD1, rawD2] : [rawD2, rawD1];

    const refDate = parseUtcDate(refIsoDate);
    const baseYear = refDate.getUTCFullYear();
    const baseMonth = refDate.getUTCMonth(); // 0-indexed

    const allDates: string[] = [];
    for (let offset = 0; offset <= 10; offset += 1) {
      const dt = new Date(Date.UTC(baseYear, baseMonth + offset, 1));
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1; // 1..12
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

      const dayA = Math.min(dMin, daysInMonth);
      const dayB = Math.min(dMax, daysInMonth);

      const isoA = `${y}-${String(m).padStart(2, "0")}-${String(dayA).padStart(2, "0")}`;
      allDates.push(isoA);
      if (dayB !== dayA) {
        const isoB = `${y}-${String(m).padStart(2, "0")}-${String(dayB).padStart(2, "0")}`;
        allDates.push(isoB);
      }
    }

    const upcoming = allDates.filter((iso) => iso >= refIsoDate);
    for (let i = 0; i < horizon + 1 && i < upcoming.length; i += 1) {
      payDates.push(upcoming[i]);
    }
  }

  const buckets: QuincenaPlanBucket[] = [];
  for (let idx = 0; idx < horizon && idx < payDates.length; idx += 1) {
    const payDate = payDates[idx];
    const nextPayDate = payDates[idx + 1] ?? addDaysIso(payDate, 15);
    const periodEnd = addDaysIso(nextPayDate, -1);

    buckets.push({
      index: idx,
      label: `Quincena ${idx + 1} (${formatShortDateEs(payDate)})`,
      pay_date: payDate,
      period_end: periodEnd,
      medications_subtotal: 0,
      events_subtotal: 0,
      total_cost: 0,
      baseline_total_cost: 0,
      over_budget: false,
      purchases: [],
      events: [],
    });
  }

  return buckets;
}

export class FinancialPlannerService {
  static async getFinancialSettings(): Promise<FinancialSettings> {
    const res = await query<FinancialSettings>(
      `SELECT
         id, currency, pay_schedule_type, payday_1, payday_2,
         biweekly_anchor_date::text AS biweekly_anchor_date,
         quincenal_budget_cap::float8 AS quincenal_budget_cap,
         monthly_budget_cap::float8 AS monthly_budget_cap,
         safety_buffer_days, planning_horizon_quincenas,
         include_events_in_plan, updated_at
       FROM financial_settings
       WHERE id = 1
       LIMIT 1`
    );
    return res.rows[0] ?? DEFAULT_FINANCIAL_SETTINGS;
  }

  static async updateFinancialSettings(
    input: UpdateFinancialSettingsInput,
    actor = "Consola Clinica Web"
  ): Promise<FinancialSettings> {
    return withTransaction(async (tx) => {
      const res = await tx.query<FinancialSettings>(
        `INSERT INTO financial_settings (
           id, currency, pay_schedule_type, payday_1, payday_2,
           biweekly_anchor_date, quincenal_budget_cap, monthly_budget_cap,
           safety_buffer_days, planning_horizon_quincenas, include_events_in_plan, updated_at
         ) VALUES (
           1, $1, $2, $3, $4,
           $5::date, $6, $7,
           $8, $9, $10, NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           currency = EXCLUDED.currency,
           pay_schedule_type = EXCLUDED.pay_schedule_type,
           payday_1 = EXCLUDED.payday_1,
           payday_2 = EXCLUDED.payday_2,
           biweekly_anchor_date = EXCLUDED.biweekly_anchor_date,
           quincenal_budget_cap = EXCLUDED.quincenal_budget_cap,
           monthly_budget_cap = EXCLUDED.monthly_budget_cap,
           safety_buffer_days = EXCLUDED.safety_buffer_days,
           planning_horizon_quincenas = EXCLUDED.planning_horizon_quincenas,
           include_events_in_plan = EXCLUDED.include_events_in_plan,
           updated_at = NOW()
         RETURNING
           id, currency, pay_schedule_type, payday_1, payday_2,
           biweekly_anchor_date::text AS biweekly_anchor_date,
           quincenal_budget_cap::float8 AS quincenal_budget_cap,
           monthly_budget_cap::float8 AS monthly_budget_cap,
           safety_buffer_days, planning_horizon_quincenas,
           include_events_in_plan, updated_at`,
        [
          input.currency?.trim() || "MXN",
          input.pay_schedule_type,
          input.payday_1,
          input.payday_2,
          input.biweekly_anchor_date || null,
          input.quincenal_budget_cap ?? null,
          input.monthly_budget_cap ?? null,
          input.safety_buffer_days,
          input.planning_horizon_quincenas,
          input.include_events_in_plan,
        ]
      );

      const settings = res.rows[0];
      await GovernanceAuditService.log(
        {
          entity_type: "FINANCIAL_SETTINGS",
          entity_id: "1",
          entity_label: settings.pay_schedule_type,
          action: "SETTINGS_UPDATE",
          actor,
          summary: `Calendario de pago actualizado (${settings.pay_schedule_type}, horizonte ${settings.planning_horizon_quincenas} quincenas).`,
        },
        tx
      );
      return settings;
    });
  }

  static async createExpense(
    input: CreateExpenseInput,
    actor = "Consola Clinica Web"
  ): Promise<MedicalExpense> {
    return withTransaction(async (tx) => {
      const expenseDate = input.expense_date.slice(0, 10);
      const qLabel = input.quincena_label?.trim() || inferQuincenaLabel(expenseDate);

      const res = await tx.query<MedicalExpense>(
        `INSERT INTO medical_expenses (
           title, category, status, amount, expense_date, quincena_label,
           medication_id, clinical_event_id, packages_purchased, units_added,
           provider_or_pharmacy, payment_method, receipt_reference, notes
         ) VALUES (
           $1, $2::expense_category, $3::expense_status, $4, $5::date, $6,
           $7::uuid, $8::uuid, $9, $10,
           $11, $12, $13, $14
         )
         RETURNING
           id, title, category, status,
           amount::float8 AS amount,
           expense_date::text AS expense_date,
           quincena_label, medication_id, clinical_event_id,
           packages_purchased::float8 AS packages_purchased,
           units_added::float8 AS units_added,
           provider_or_pharmacy, payment_method, receipt_reference, notes,
           created_at, updated_at`,
        [
          input.title.trim(),
          input.category,
          input.status ?? "PAID",
          input.amount,
          expenseDate,
          qLabel,
          input.medication_id || null,
          input.clinical_event_id || null,
          input.packages_purchased ?? null,
          input.units_added ?? null,
          input.provider_or_pharmacy?.trim() || null,
          input.payment_method?.trim() || null,
          input.receipt_reference?.trim() || null,
          input.notes?.trim() || null,
        ]
      );

      const created = res.rows[0];
      await GovernanceAuditService.log(
        {
          entity_type: "EXPENSE",
          entity_id: created.id,
          entity_label: created.title,
          action: "CREATE",
          actor,
          summary: `Gasto registrado: "${created.title}" por $${created.amount.toFixed(2)} MXN (${created.category}).`,
        },
        tx
      );
      return created;
    });
  }

  static async updateExpense(
    expenseId: string,
    input: CreateExpenseInput,
    actor = "Consola Clinica Web"
  ): Promise<MedicalExpense> {
    return withTransaction(async (tx) => {
      const expenseDate = input.expense_date.slice(0, 10);
      const qLabel = input.quincena_label?.trim() || inferQuincenaLabel(expenseDate);

      const res = await tx.query<MedicalExpense>(
        `UPDATE medical_expenses
         SET title = $2,
             category = $3::expense_category,
             status = $4::expense_status,
             amount = $5,
             expense_date = $6::date,
             quincena_label = $7,
             medication_id = $8::uuid,
             clinical_event_id = $9::uuid,
             packages_purchased = $10,
             units_added = $11,
             provider_or_pharmacy = $12,
             payment_method = $13,
             receipt_reference = $14,
             notes = $15,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING
           id, title, category, status,
           amount::float8 AS amount,
           expense_date::text AS expense_date,
           quincena_label, medication_id, clinical_event_id,
           packages_purchased::float8 AS packages_purchased,
           units_added::float8 AS units_added,
           provider_or_pharmacy, payment_method, receipt_reference, notes,
           created_at, updated_at`,
        [
          expenseId,
          input.title.trim(),
          input.category,
          input.status ?? "PAID",
          input.amount,
          expenseDate,
          qLabel,
          input.medication_id || null,
          input.clinical_event_id || null,
          input.packages_purchased ?? null,
          input.units_added ?? null,
          input.provider_or_pharmacy?.trim() || null,
          input.payment_method?.trim() || null,
          input.receipt_reference?.trim() || null,
          input.notes?.trim() || null,
        ]
      );

      const updated = res.rows[0];
      if (!updated) {
        throw new Error("Gasto medico no encontrado.");
      }

      await GovernanceAuditService.log(
        {
          entity_type: "EXPENSE",
          entity_id: updated.id,
          entity_label: updated.title,
          action: "UPDATE",
          actor,
          summary: `Gasto "${updated.title}" actualizado ($${updated.amount.toFixed(2)} MXN).`,
        },
        tx
      );
      return updated;
    });
  }

  static async deleteExpense(
    expenseId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    return withTransaction(async (tx) => {
      const res = await tx.query<{ id: string; title: string; amount: number }>(
        `DELETE FROM medical_expenses WHERE id = $1::uuid
         RETURNING id, title, amount::float8 AS amount`,
        [expenseId]
      );
      const deleted = res.rows[0];
      if (!deleted) {
        throw new Error("Gasto medico no encontrado.");
      }

      await GovernanceAuditService.log(
        {
          entity_type: "EXPENSE",
          entity_id: deleted.id,
          entity_label: deleted.title,
          action: "DELETE",
          actor,
          summary: `Gasto "${deleted.title}" ($${deleted.amount.toFixed(2)}) eliminado.`,
        },
        tx
      );
      return { deletedId: deleted.id };
    });
  }

  static async executePlannedPurchase(
    input: ExecutePlannedPurchaseInput,
    actor = "Consola Clinica Web"
  ): Promise<{
    medication: Medication;
    expense: MedicalExpense;
    unitsAdded: number;
  }> {
    const result = await withTransaction(async (tx) => {
      const medPrevRes = await tx.query<Medication>(
        `SELECT *,
           units_per_package::float8 AS units_per_package,
           package_price::float8 AS package_price,
           dose_amount::float8 AS dose_amount,
           current_stock::float8 AS current_stock,
           daily_consumption_rate::float8 AS daily_consumption_rate,
           days_of_supply_remaining::float8 AS days_of_supply_remaining
         FROM medications
         WHERE id = $1::uuid`,
        [input.medication_id]
      );
      const medPrev = medPrevRes.rows[0];
      if (!medPrev) {
        throw new Error("Medicamento no encontrado para registrar compra.");
      }

      const unitsPerPkg = medPrev.units_per_package ?? 30;
      const unitsAdded =
        input.units_override && input.units_override > 0
          ? input.units_override
          : Number((input.packages * unitsPerPkg).toFixed(2));

      const nextPrice =
        input.package_price !== undefined && input.package_price !== null
          ? input.package_price
          : medPrev.package_price;

      const medRes = await tx.query<Medication>(
        `UPDATE medications
         SET current_stock = COALESCE(current_stock, 0) + $2,
             package_price = COALESCE($3, package_price),
             preferred_pharmacy = COALESCE($4, preferred_pharmacy),
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING *,
           units_per_package::float8 AS units_per_package,
           package_price::float8 AS package_price,
           dose_amount::float8 AS dose_amount,
           current_stock::float8 AS current_stock,
           daily_consumption_rate::float8 AS daily_consumption_rate,
           days_of_supply_remaining::float8 AS days_of_supply_remaining`,
        [
          input.medication_id,
          unitsAdded,
          nextPrice ?? null,
          input.provider_or_pharmacy?.trim() || null,
        ]
      );
      const updatedMed = medRes.rows[0];

      const notifRes = await tx.query<{
        id: string;
        title: string;
        message: string;
        status: string;
        telegram_message_ids: unknown;
      }>(
        `WITH prev AS (
           SELECT id, title, message, status, telegram_message_ids
           FROM notification_queue
           WHERE source_type = 'RESTOCK_ALERT'
             AND source_id = $1::uuid
             AND status IN ('QUEUED', 'SENT')
         )
         UPDATE notification_queue nq
         SET status = 'ACKNOWLEDGED',
             acknowledged_at = NOW(),
             acknowledged_by_chat_id = $2
         FROM prev
         WHERE nq.id = prev.id
         RETURNING prev.id, prev.title, prev.message, prev.status, prev.telegram_message_ids`,
        [input.medication_id, actor]
      );

      const purchaseDate = (input.purchase_date || new Date().toISOString()).slice(0, 10);
      const qLabel = input.quincena_label?.trim() || inferQuincenaLabel(purchaseDate);

      const expRes = await tx.query<MedicalExpense>(
        `INSERT INTO medical_expenses (
           title, category, status, amount, expense_date, quincena_label,
           medication_id, packages_purchased, units_added,
           provider_or_pharmacy, payment_method, notes
         ) VALUES (
           $1, 'MEDICATION', 'PAID', $2, $3::date, $4,
           $5::uuid, $6, $7, $8, $9, $10
         )
         RETURNING
           id, title, category, status,
           amount::float8 AS amount,
           expense_date::text AS expense_date,
           quincena_label, medication_id, clinical_event_id,
           packages_purchased::float8 AS packages_purchased,
           units_added::float8 AS units_added,
           provider_or_pharmacy, payment_method, receipt_reference, notes,
           created_at, updated_at`,
        [
          `Compra ${updatedMed.name} (${input.packages} envase/s)`,
          input.total_amount,
          purchaseDate,
          qLabel,
          updatedMed.id,
          input.packages,
          unitsAdded,
          input.provider_or_pharmacy?.trim() || updatedMed.preferred_pharmacy || null,
          input.payment_method?.trim() || null,
          input.notes?.trim() || null,
        ]
      );

      const expense = expRes.rows[0];
      await GovernanceAuditService.log(
        {
          entity_type: "MEDICATION",
          entity_id: updatedMed.id,
          entity_label: updatedMed.name,
          action: "PURCHASE_EXECUTED",
          actor,
          summary: `Compra ejecutada: +${unitsAdded} ${updatedMed.presentation} de "${updatedMed.name}" por $${expense.amount.toFixed(2)} MXN.`,
        },
        tx
      );

      return {
        medication: updatedMed,
        expense,
        unitsAdded,
        sentNotifications: notifRes.rows.filter((n) => n.status === "SENT"),
      };
    });

    if (result.sentNotifications.length > 0) {
      const { TelegramNotificationService } = await import(
        "./telegram-notification.service"
      );
      await TelegramNotificationService.syncRestockFromWeb(
        {
          id: result.medication.id,
          name: result.medication.name,
          presentation: result.medication.presentation,
          current_stock: result.medication.current_stock ?? 0,
          days_of_supply_remaining: result.medication.days_of_supply_remaining ?? 0,
        },
        result.sentNotifications
      );
    }

    return {
      medication: result.medication,
      expense: result.expense,
      unitsAdded: result.unitsAdded,
    };
  }

  static buildFinancialSnapshot(
    medications: Medication[],
    upcomingEvents: ClinicalEventItem[],
    settingsInput: FinancialSettings | null | undefined,
    expenses: MedicalExpense[],
    referenceDate: Date = new Date()
  ): FinancialPlanSnapshot {
    const settings = settingsInput ?? DEFAULT_FINANCIAL_SETTINGS;
    const refIso = toIsoDate(referenceDate);
    const buckets = generatePaydayBuckets(settings, refIso);

    if (buckets.length === 0) {
      return {
        generated_at: new Date().toISOString(),
        settings,
        buckets: [],
        summary: {
          monthly_run_rate_meds: 0,
          monthly_run_rate_events: 0,
          monthly_run_rate_total: 0,
          baseline_peak_quincena: 0,
          optimized_peak_quincena: 0,
          peak_reduction_mxn: 0,
          peak_reduction_pct: 0,
          average_quincenal_planned: 0,
          horizon_total_planned: 0,
          paid_current_month_mxn: 0,
          paid_total_mxn: 0,
          shifted_purchases_count: 0,
        },
        reserve_alerts: [],
        incomplete_pricing_medications: [],
      };
    }

    const horizonEndIso = buckets[buckets.length - 1].period_end;
    const horizonDays = Math.max(15, diffDaysIso(refIso, horizonEndIso) + 1);

    // 1. Asignar eventos clinicos fijos con costo estimado > 0 a su quincena correspondiente
    if (settings.include_events_in_plan) {
      for (const evt of upcomingEvents) {
        if (evt.is_completed) continue;
        const cost = Number(evt.estimated_cost ?? 0);
        if (!Number.isFinite(cost) || cost <= 0) continue;

        const evtDate = toIsoStringSafe(evt.event_datetime).slice(0, 10);
        if (evtDate > horizonEndIso) continue;

        let targetIdx = buckets.findIndex(
          (b) => evtDate >= b.pay_date && evtDate <= b.period_end
        );
        if (targetIdx === -1) {
          if (evtDate < buckets[0].pay_date) {
            targetIdx = 0;
          } else {
            continue;
          }
        }

        const plannedEvt: PlannedEventExpense = {
          event_id: evt.id,
          title: evt.title,
          category: evt.category,
          event_date: evtDate,
          estimated_cost: Number(cost.toFixed(2)),
          date_is_estimated: evt.date_is_estimated,
          specialist_or_center: evt.specialist_or_center,
          quincena_idx: targetIdx,
        };
        buckets[targetIdx].events.push(plannedEvt);
        buckets[targetIdx].events_subtotal = Number(
          (buckets[targetIdx].events_subtotal + plannedEvt.estimated_cost).toFixed(2)
        );
      }
    }

    // 2. Identificar medicamentos incompletos vs planificables y simular agotamiento
    const incompletePricingMeds: FinancialPlanSnapshot["incomplete_pricing_medications"] = [];
    const candidatePurchases: PlannedMedicationPurchase[] = [];

    let monthlyMedsRunRate = 0;

    for (const med of medications) {
      if (!med.is_active) continue;

      const missingFields: string[] = [];
      if (med.current_stock === null || med.current_stock === undefined) {
        missingFields.push("Inventario inicial");
      }
      if (med.units_per_package === null || med.units_per_package === undefined || med.units_per_package <= 0) {
        missingFields.push("Unidades por envase");
      }
      if (med.package_price === null || med.package_price === undefined || med.package_price < 0) {
        missingFields.push("Precio por envase");
      }

      if (missingFields.length > 0) {
        incompletePricingMeds.push({
          id: med.id,
          name: med.name,
          missing_fields: missingFields,
        });
        continue;
      }

      const unitsPerPkg = Number(med.units_per_package);
      const pkgPrice = Number(med.package_price);
      const rate = Number(med.daily_consumption_rate);

      if (rate <= 0) continue;

      monthlyMedsRunRate += ((rate * 30) / unitsPerPkg) * pkgPrice;

      const bufferDays = Math.max(
        1,
        Math.round(med.safety_buffer_days ?? settings.safety_buffer_days ?? 7)
      );
      let simStock = Number(med.current_stock);
      let seq = 0;

      while (seq < 24) {
        const depleteDays = simStock / rate;
        if (depleteDays > horizonDays + bufferDays) {
          break;
        }
        seq += 1;

        const depleteDate = addDaysIso(refIso, Math.max(0, Math.floor(depleteDays)));
        const safePurchaseOffset = Math.max(0, Math.floor(depleteDays - bufferDays));
        const safeDeadlineDate = addDaysIso(refIso, safePurchaseOffset);

        // Ultima quincena cuyo pay_date <= safeDeadlineDate
        let latestIdx = 0;
        let urgentBeforePayday = false;
        if (safeDeadlineDate < buckets[0].pay_date) {
          latestIdx = 0;
          urgentBeforePayday = depleteDate < buckets[0].pay_date;
        } else {
          for (let k = buckets.length - 1; k >= 0; k -= 1) {
            if (buckets[k].pay_date <= safeDeadlineDate) {
              latestIdx = k;
              break;
            }
          }
        }

        candidatePurchases.push({
          plan_item_id: `${med.id}:${seq}`,
          medication_id: med.id,
          medication_name: med.name,
          presentation: med.presentation,
          packages: 1,
          units_per_package: unitsPerPkg,
          package_price: Number(pkgPrice.toFixed(2)),
          total_cost: Number(pkgPrice.toFixed(2)),
          purchase_priority: med.purchase_priority ?? 2,
          preferred_pharmacy: med.preferred_pharmacy ?? null,
          current_stock_at_start: Number(simStock.toFixed(2)),
          projected_depletion_date: depleteDate,
          recommended_deadline_date: safeDeadlineDate,
          latest_quincena_idx: latestIdx,
          assigned_quincena_idx: latestIdx,
          shifted_from_quincena_label: null,
          optimization_reason: null,
          urgent_before_payday: urgentBeforePayday,
        });

        simStock += unitsPerPkg;
      }
    }

    // 3. Baseline sin optimizar (cada compra en su ultima quincena posible)
    const baselineTotals = buckets.map((b) => b.events_subtotal);
    for (const item of candidatePurchases) {
      baselineTotals[item.latest_quincena_idx] = Number(
        (baselineTotals[item.latest_quincena_idx] + item.total_cost).toFixed(2)
      );
    }

    // 4. Optimizador Min-Max de Quincenas: adelantar hasta 2 quincenas para suavizar picos
    const optimizedTotals = buckets.map((b) => b.events_subtotal);
    const orderedCandidates = [...candidatePurchases].sort((a, b) => {
      if (a.latest_quincena_idx !== b.latest_quincena_idx) {
        return a.latest_quincena_idx - b.latest_quincena_idx;
      }
      if (b.total_cost !== a.total_cost) {
        return b.total_cost - a.total_cost;
      }
      return a.purchase_priority - b.purchase_priority;
    });

    const lastAssignedByMed = new Map<string, number>();
    const cap = settings.quincenal_budget_cap ?? null;
    let shiftedCount = 0;

    for (const item of orderedCandidates) {
      const minMedIdx = lastAssignedByMed.get(item.medication_id) ?? 0;
      const maxLookback = cap !== null && optimizedTotals[item.latest_quincena_idx] + item.total_cost > cap ? 3 : 2;
      const windowStart = Math.max(minMedIdx, item.latest_quincena_idx - maxLookback);

      let bestIdx = item.latest_quincena_idx;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let q = windowStart; q <= item.latest_quincena_idx; q += 1) {
        const candidateLoad = optimizedTotals[q] + item.total_cost;
        const overflowPenalty =
          cap !== null && candidateLoad > cap ? (candidateLoad - cap) * 1000 : 0;
        const earlyPenalty = (item.latest_quincena_idx - q) * 1.0;
        const score = candidateLoad + overflowPenalty + earlyPenalty;

        if (score < bestScore) {
          bestScore = score;
          bestIdx = q;
        }
      }

      item.assigned_quincena_idx = bestIdx;
      if (bestIdx < item.latest_quincena_idx) {
        const originLabel = buckets[item.latest_quincena_idx].label;
        item.shifted_from_quincena_label = originLabel;
        item.optimization_reason = `Adelantada desde ${originLabel} para aligerar acumulacion de gasto.`;
        shiftedCount += 1;
      }

      optimizedTotals[bestIdx] = Number(
        (optimizedTotals[bestIdx] + item.total_cost).toFixed(2)
      );
      lastAssignedByMed.set(item.medication_id, bestIdx);
      buckets[bestIdx].purchases.push(item);
      buckets[bestIdx].medications_subtotal = Number(
        (buckets[bestIdx].medications_subtotal + item.total_cost).toFixed(2)
      );
    }

    for (let k = 0; k < buckets.length; k += 1) {
      buckets[k].total_cost = Number(
        (buckets[k].medications_subtotal + buckets[k].events_subtotal).toFixed(2)
      );
      buckets[k].baseline_total_cost = Number(baselineTotals[k].toFixed(2));
      buckets[k].over_budget =
        cap !== null ? buckets[k].total_cost > cap : false;
      buckets[k].purchases.sort((a, b) => b.total_cost - a.total_cost);
    }

    // 5. Run-rate de eventos y metricas globales
    let monthlyEventsRunRate = 0;
    for (const evt of upcomingEvents) {
      if (evt.is_completed) continue;
      const cost = Number(evt.estimated_cost ?? 0);
      if (cost <= 0) continue;
      if (evt.is_recurring && evt.recurrence_interval_days && evt.recurrence_interval_days > 0) {
        monthlyEventsRunRate += (cost / evt.recurrence_interval_days) * 30;
      } else {
        // Evento unico dentro de los proximos 365 dias prorrateado o contado si es < 30d
        const daysAway = diffDaysIso(refIso, toIsoStringSafe(evt.event_datetime).slice(0, 10));
        if (daysAway >= 0 && daysAway <= 30) {
          monthlyEventsRunRate += cost;
        }
      }
    }

    const baselinePeak = Math.max(...buckets.map((b) => b.baseline_total_cost), 0);
    const optimizedPeak = Math.max(...buckets.map((b) => b.total_cost), 0);
    const peakReduction = Math.max(0, Number((baselinePeak - optimizedPeak).toFixed(2)));
    const peakReductionPct =
      baselinePeak > 0
        ? Number(((peakReduction / baselinePeak) * 100).toFixed(1))
        : 0;
    const horizonTotal = buckets.reduce((acc, b) => acc + b.total_cost, 0);
    const avgQuincenal = buckets.length > 0 ? horizonTotal / buckets.length : 0;

    // 6. Alertas de fondo de reserva para quincenas pesadas
    const reserveAlerts: ReserveAlertItem[] = [];
    for (const bucket of buckets) {
      const highThreshold = cap ?? avgQuincenal * 1.3;
      if (
        bucket.index > 0 &&
        (bucket.events_subtotal >= 1200 ||
          (highThreshold > 0 && bucket.total_cost > highThreshold))
      ) {
        const quincenasPrevias = Math.min(3, bucket.index);
        const amountToReserve =
          bucket.events_subtotal >= 1200
            ? bucket.events_subtotal
            : Math.max(0, bucket.total_cost - avgQuincenal);
        const perQuincena = Number(
          (amountToReserve / Math.max(1, quincenasPrevias)).toFixed(2)
        );
        reserveAlerts.push({
          quincena_label: bucket.label,
          pay_date: bucket.pay_date,
          total_cost: bucket.total_cost,
          events_subtotal: bucket.events_subtotal,
          suggested_per_quincena_reserve: perQuincena,
          message: `La ${bucket.label} concentra $${bucket.total_cost.toFixed(2)} MXN ($${bucket.events_subtotal.toFixed(2)} en consultas/estudios). Conviene apartar $${perQuincena.toFixed(2)} MXN en cada una de las ${quincenasPrevias} quincena(s) previa(s).`,
        });
      }
    }

    // 7. Gastos reales pagados
    const currentMonthPrefix = refIso.slice(0, 7);
    let paidCurrentMonth = 0;
    let paidTotal = 0;
    for (const exp of expenses) {
      if (exp.status !== "PAID") continue;
      const amt = Number(exp.amount || 0);
      paidTotal += amt;
      if (exp.expense_date.startsWith(currentMonthPrefix)) {
        paidCurrentMonth += amt;
      }
    }

    const summary: FinancialOptimizationSummary = {
      monthly_run_rate_meds: Number(monthlyMedsRunRate.toFixed(2)),
      monthly_run_rate_events: Number(monthlyEventsRunRate.toFixed(2)),
      monthly_run_rate_total: Number((monthlyMedsRunRate + monthlyEventsRunRate).toFixed(2)),
      baseline_peak_quincena: Number(baselinePeak.toFixed(2)),
      optimized_peak_quincena: Number(optimizedPeak.toFixed(2)),
      peak_reduction_mxn: peakReduction,
      peak_reduction_pct: peakReductionPct,
      average_quincenal_planned: Number(avgQuincenal.toFixed(2)),
      horizon_total_planned: Number(horizonTotal.toFixed(2)),
      paid_current_month_mxn: Number(paidCurrentMonth.toFixed(2)),
      paid_total_mxn: Number(paidTotal.toFixed(2)),
      shifted_purchases_count: shiftedCount,
    };

    return {
      generated_at: new Date().toISOString(),
      settings,
      buckets,
      summary,
      reserve_alerts: reserveAlerts,
      incomplete_pricing_medications: incompletePricingMeds,
    };
  }
}
