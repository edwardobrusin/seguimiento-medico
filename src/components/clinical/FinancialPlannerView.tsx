"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Edit3,
  PackagePlus,
  Plus,
  Settings2,
  ShoppingCart,
  Trash2,
  TrendingDown,
  Wallet,
} from "lucide-react";
import type {
  CommandCenterSnapshot,
  ExpenseCategory,
  ExpenseStatus,
  MedicalExpense,
  PayScheduleType,
  PlannedMedicationPurchase,
  QuincenaPlanBucket,
} from "@/lib/types/clinical";
import {
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_TAG,
  EXPENSE_STATUS_TAG,
  EVENT_CATEGORY_TAG,
  PAY_SCHEDULE_LABEL,
} from "@/lib/clinical-labels";
import {
  cn,
  formatCurrencyMxn,
  formatDateOnlyEs,
  getLocalDateIso,
} from "@/lib/utils";
import { ClinicalModal } from "./ClinicalModal";
import { IconActionButton } from "./IconActionButton";
import { StatusBadge } from "./StatusBadge";

interface ExpensePayload {
  title: string;
  category: ExpenseCategory;
  status: ExpenseStatus;
  amount: number;
  expense_date: string;
  quincena_label: string | null;
  medication_id: string | null;
  clinical_event_id: string | null;
  provider_or_pharmacy: string | null;
  payment_method: string | null;
  notes: string | null;
}

interface FinancialPlannerViewProps {
  snapshot: CommandCenterSnapshot;
  isAdmin: boolean;
  onUpdateSettings: (payload: {
    currency: string;
    pay_schedule_type: PayScheduleType;
    payday_1: number;
    payday_2: number;
    biweekly_anchor_date: string | null;
    quincenal_budget_cap: number | null;
    monthly_budget_cap: number | null;
    safety_buffer_days: number;
    planning_horizon_quincenas: number;
    include_events_in_plan: boolean;
  }) => Promise<void>;
  onCreateExpense: (payload: ExpensePayload) => Promise<void>;
  onUpdateExpense: (expenseId: string, payload: ExpensePayload) => Promise<void>;
  onDeleteExpense: (expenseId: string) => Promise<void>;
  onExecutePlannedPurchase: (payload: {
    medication_id: string;
    packages: number;
    package_price: number | null;
    total_amount: number;
    purchase_date: string;
    quincena_label: string;
    provider_or_pharmacy: string | null;
    payment_method: string | null;
    notes: string | null;
  }) => Promise<void>;
  onNavigateToInventory: () => void;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "MEDICATION",
  "APPOINTMENT",
  "LAB_TEST",
  "IMAGING",
  "PROCEDURE",
  "THERAPY",
  "INSURANCE",
  "OTHER",
];
const PAY_TYPES: PayScheduleType[] = [
  "QUINCENAL_15_30",
  "QUINCENAL_1_15",
  "CUSTOM_DAYS",
  "CATORCENAL",
];

function parseOptionalNonNeg(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function FinancialPlannerView({
  snapshot,
  isAdmin,
  onUpdateSettings,
  onCreateExpense,
  onUpdateExpense,
  onDeleteExpense,
  onExecutePlannedPurchase,
  onNavigateToInventory,
}: FinancialPlannerViewProps) {
  const plan = snapshot.financial_plan;
  const summary = plan.summary;

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expenseFilter, setExpenseFilter] = useState<"ALL" | ExpenseStatus>(
    "ALL"
  );

  // Settings modal (re-sincronizado al abrir)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sPayType, setSPayType] = useState<PayScheduleType>("QUINCENAL_15_30");
  const [sPayday1, setSPayday1] = useState("15");
  const [sPayday2, setSPayday2] = useState("30");
  const [sAnchor, setSAnchor] = useState("");
  const [sQCap, setSQCap] = useState("");
  const [sMCap, setSMCap] = useState("");
  const [sBuffer, setSBuffer] = useState("7");
  const [sHorizon, setSHorizon] = useState("6");
  const [sIncludeEvents, setSIncludeEvents] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Expense modal
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<MedicalExpense | null>(
    null
  );
  const [eTitle, setETitle] = useState("");
  const [eCategory, setECategory] = useState<ExpenseCategory>("MEDICATION");
  const [eStatus, setEStatus] = useState<ExpenseStatus>("PAID");
  const [eAmount, setEAmount] = useState("");
  const [eDate, setEDate] = useState(getLocalDateIso());
  const [eQuincena, setEQuincena] = useState("");
  const [eMedId, setEMedId] = useState("");
  const [eEventId, setEEventId] = useState("");
  const [eProvider, setEProvider] = useState("");
  const [eMethod, setEMethod] = useState("");
  const [eNotes, setENotes] = useState("");
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [savingExpense, setSavingExpense] = useState(false);

  // Execute purchase modal
  const [purchaseItem, setPurchaseItem] = useState<{
    item: PlannedMedicationPurchase;
    bucket: QuincenaPlanBucket;
  } | null>(null);
  const [pPackages, setPPackages] = useState("1");
  const [pPrice, setPPrice] = useState("");
  const [pTotal, setPTotal] = useState("");
  const [pDate, setPDate] = useState(getLocalDateIso());
  const [pProvider, setPProvider] = useState("");
  const [pMethod, setPMethod] = useState("Tarjeta");
  const [pNotes, setPNotes] = useState("");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [savingPurchase, setSavingPurchase] = useState(false);

  const filteredExpenses = useMemo(
    () =>
      snapshot.recent_expenses.filter(
        (e) => expenseFilter === "ALL" || e.status === expenseFilter
      ),
    [snapshot.recent_expenses, expenseFilter]
  );

  const peakBucket = useMemo(() => {
    let max = 0;
    for (const b of plan.buckets) max = Math.max(max, b.total_cost);
    return max;
  }, [plan.buckets]);

  function openSettings() {
    const s = snapshot.financial_settings;
    setSPayType(s.pay_schedule_type);
    setSPayday1(String(s.payday_1));
    setSPayday2(String(s.payday_2));
    setSAnchor(s.biweekly_anchor_date ? s.biweekly_anchor_date.slice(0, 10) : "");
    setSQCap(s.quincenal_budget_cap === null ? "" : String(s.quincenal_budget_cap));
    setSMCap(s.monthly_budget_cap === null ? "" : String(s.monthly_budget_cap));
    setSBuffer(String(s.safety_buffer_days));
    setSHorizon(String(s.planning_horizon_quincenas));
    setSIncludeEvents(s.include_events_in_plan);
    setSettingsError(null);
    setSettingsOpen(true);
  }

  async function handleSettingsSubmit(e: FormEvent) {
    e.preventDefault();
    setSettingsError(null);
    const p1 = Number.parseInt(sPayday1, 10);
    const p2 = Number.parseInt(sPayday2, 10);
    if (!(p1 >= 1 && p1 <= 31 && p2 >= 1 && p2 <= 31)) {
      setSettingsError("Los dias de pago deben estar entre 1 y 31.");
      return;
    }
    if (sPayType === "CATORCENAL" && !sAnchor) {
      setSettingsError("El esquema catorcenal requiere una fecha ancla de pago.");
      return;
    }
    const buffer = Number.parseInt(sBuffer, 10);
    const horizon = Number.parseInt(sHorizon, 10);
    if (!(buffer >= 1 && buffer <= 60)) {
      setSettingsError("El colchon de seguridad debe estar entre 1 y 60 dias.");
      return;
    }
    if (!(horizon >= 2 && horizon <= 12)) {
      setSettingsError("El horizonte debe estar entre 2 y 12 quincenas.");
      return;
    }
    setSavingSettings(true);
    try {
      await onUpdateSettings({
        currency: snapshot.financial_settings.currency || "MXN",
        pay_schedule_type: sPayType,
        payday_1: p1,
        payday_2: p2,
        biweekly_anchor_date: sAnchor || null,
        quincenal_budget_cap: parseOptionalNonNeg(sQCap),
        monthly_budget_cap: parseOptionalNonNeg(sMCap),
        safety_buffer_days: buffer,
        planning_horizon_quincenas: horizon,
        include_events_in_plan: sIncludeEvents,
      });
      setSettingsOpen(false);
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : "No se pudo guardar la configuracion."
      );
    } finally {
      setSavingSettings(false);
    }
  }

  function openCreateExpense() {
    setEditingExpense(null);
    setETitle("");
    setECategory("MEDICATION");
    setEStatus("PAID");
    setEAmount("");
    setEDate(getLocalDateIso());
    setEQuincena("");
    setEMedId("");
    setEEventId("");
    setEProvider("");
    setEMethod("");
    setENotes("");
    setExpenseError(null);
    setExpenseOpen(true);
  }

  function openEditExpense(exp: MedicalExpense) {
    setEditingExpense(exp);
    setETitle(exp.title);
    setECategory(exp.category);
    setEStatus(exp.status);
    setEAmount(String(exp.amount));
    setEDate(exp.expense_date.slice(0, 10));
    setEQuincena(exp.quincena_label ?? "");
    setEMedId(exp.medication_id ?? "");
    setEEventId(exp.clinical_event_id ?? "");
    setEProvider(exp.provider_or_pharmacy ?? "");
    setEMethod(exp.payment_method ?? "");
    setENotes(exp.notes ?? "");
    setExpenseError(null);
    setExpenseOpen(true);
  }

  async function handleExpenseSubmit(e: FormEvent) {
    e.preventDefault();
    setExpenseError(null);
    if (!eTitle.trim()) {
      setExpenseError("Ingresa el concepto del gasto.");
      return;
    }
    const amount = parseOptionalNonNeg(eAmount);
    if (amount === null) {
      setExpenseError("Ingresa un monto valido mayor o igual a 0.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eDate)) {
      setExpenseError("Selecciona una fecha valida.");
      return;
    }
    const payload: ExpensePayload = {
      title: eTitle.trim(),
      category: eCategory,
      status: eStatus,
      amount,
      expense_date: eDate,
      quincena_label: eQuincena.trim() || null,
      medication_id: eMedId || null,
      clinical_event_id: eEventId || null,
      provider_or_pharmacy: eProvider.trim() || null,
      payment_method: eMethod.trim() || null,
      notes: eNotes.trim() || null,
    };
    setSavingExpense(true);
    try {
      if (editingExpense) {
        await onUpdateExpense(editingExpense.id, payload);
      } else {
        await onCreateExpense(payload);
      }
      setExpenseOpen(false);
    } catch (err) {
      setExpenseError(
        err instanceof Error ? err.message : "No se pudo guardar el gasto."
      );
    } finally {
      setSavingExpense(false);
    }
  }

  function openPurchase(item: PlannedMedicationPurchase, bucket: QuincenaPlanBucket) {
    setPurchaseItem({ item, bucket });
    setPPackages(String(item.packages));
    setPPrice(String(item.package_price));
    setPTotal(String(item.total_cost));
    setPDate(getLocalDateIso());
    setPProvider(item.preferred_pharmacy ?? "");
    setPMethod("Tarjeta");
    setPNotes("");
    setPurchaseError(null);
  }

  async function handlePurchaseSubmit(e: FormEvent) {
    e.preventDefault();
    if (!purchaseItem) return;
    setPurchaseError(null);
    const pkgs = Number(pPackages);
    if (!Number.isFinite(pkgs) || pkgs <= 0) {
      setPurchaseError("El numero de cajas debe ser mayor a 0.");
      return;
    }
    const total = parseOptionalNonNeg(pTotal);
    if (total === null) {
      setPurchaseError("Ingresa el total pagado.");
      return;
    }
    setSavingPurchase(true);
    try {
      await onExecutePlannedPurchase({
        medication_id: purchaseItem.item.medication_id,
        packages: pkgs,
        package_price: parseOptionalNonNeg(pPrice),
        total_amount: total,
        purchase_date: pDate,
        quincena_label: purchaseItem.bucket.label,
        provider_or_pharmacy: pProvider.trim() || null,
        payment_method: pMethod.trim() || null,
        notes: pNotes.trim() || null,
      });
      setPurchaseItem(null);
    } catch (err) {
      setPurchaseError(
        err instanceof Error ? err.message : "No se pudo registrar la compra."
      );
    } finally {
      setSavingPurchase(false);
    }
  }

  const settings = snapshot.financial_settings;

  return (
    <div className="space-y-5 clinical-enter">
      {/* Encabezado */}
      <section className="clinical-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-[#0F172A]">
              Plan Quincenal de Compras y Gastos Medicos
            </h2>
            <p className="mt-1 text-[14px] text-[#475569]">
              {PAY_SCHEDULE_LABEL[settings.pay_schedule_type]} | Colchon de{" "}
              {settings.safety_buffer_days} dias | Horizonte de{" "}
              {settings.planning_horizon_quincenas} quincenas
              {settings.quincenal_budget_cap !== null
                ? ` | Tope quincenal ${formatCurrencyMxn(settings.quincenal_budget_cap)}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <IconActionButton
              icon={Settings2}
              label="Configurar dias de pago, topes y horizonte del plan"
              shortLabel="Configurar"
              tone="neutral"
              onClick={openSettings}
            />
            <IconActionButton
              icon={Plus}
              label="Registrar un gasto medico"
              shortLabel="Nuevo Gasto"
              tone="primary"
              onClick={openCreateExpense}
            />
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="clinical-card p-4">
          <div className="flex items-center justify-between text-[13px] font-medium text-[#475569]">
            Gasto mensual proyectado
            <Wallet className="w-4 h-4 text-[#0E7490]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[22px] font-bold tabular-nums text-[#0F172A]">
            {formatCurrencyMxn(summary.monthly_run_rate_total)}
          </p>
          <p className="mt-1 text-[12px] text-[#475569] tabular-nums">
            Medicamentos {formatCurrencyMxn(summary.monthly_run_rate_meds)} | Eventos{" "}
            {formatCurrencyMxn(summary.monthly_run_rate_events)}
          </p>
        </div>
        <div className="clinical-card p-4">
          <div className="flex items-center justify-between text-[13px] font-medium text-[#475569]">
            Promedio por quincena
            <ShoppingCart className="w-4 h-4 text-[#0E7490]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[22px] font-bold tabular-nums text-[#0F172A]">
            {formatCurrencyMxn(summary.average_quincenal_planned)}
          </p>
          <p className="mt-1 text-[12px] text-[#475569] tabular-nums">
            Total horizonte {formatCurrencyMxn(summary.horizon_total_planned)}
          </p>
        </div>
        <div className="clinical-card p-4">
          <div className="flex items-center justify-between text-[13px] font-medium text-[#475569]">
            Reduccion del pico
            <TrendingDown className="w-4 h-4 text-[#065F46]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[22px] font-bold tabular-nums text-[#065F46]">
            {formatCurrencyMxn(summary.peak_reduction_mxn)}
          </p>
          <p className="mt-1 text-[12px] text-[#475569] tabular-nums">
            {summary.peak_reduction_pct}% | {summary.shifted_purchases_count} compras redistribuidas
          </p>
        </div>
        <div className="clinical-card p-4">
          <div className="flex items-center justify-between text-[13px] font-medium text-[#475569]">
            Pagado este mes
            <Wallet className="w-4 h-4 text-[#0E7490]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[22px] font-bold tabular-nums text-[#0F172A]">
            {formatCurrencyMxn(summary.paid_current_month_mxn)}
          </p>
          <p className="mt-1 text-[12px] text-[#475569] tabular-nums">
            Historico {formatCurrencyMxn(summary.paid_total_mxn)}
          </p>
        </div>
      </section>

      {/* Avisos */}
      {plan.incomplete_pricing_medications.length > 0 && (
        <section className="clinical-card p-4 border-[#FDE68A] bg-[#FFFBEB] flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-[#92400E] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-[14px] font-semibold text-[#92400E]">
                Medicamentos con datos comerciales pendientes (no entran al plan hasta completarlos)
              </p>
              <ul className="mt-1 text-[13px] text-[#78350F] space-y-0.5">
                {plan.incomplete_pricing_medications.map((m) => (
                  <li key={m.id}>
                    {m.name}: falta {m.missing_fields.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            onClick={onNavigateToInventory}
            className="clinical-btn px-3 border border-[#F59E0B] bg-white text-[#92400E] text-[13px] font-semibold"
          >
            Completar en Inventario
          </button>
        </section>
      )}

      {plan.reserve_alerts.length > 0 && (
        <section className="clinical-card p-4 border-[#A5F3FC] bg-[#ECFEFF] space-y-1.5">
          <p className="text-[14px] font-semibold text-[#164E63]">
            Reservas sugeridas para quincenas con gastos fuertes
          </p>
          {plan.reserve_alerts.map((r) => (
            <p key={r.quincena_label} className="text-[13px] text-[#164E63]">
              {r.message}
            </p>
          ))}
        </section>
      )}

      {/* Quincenas */}
      <section aria-label="Plan por quincena" className="space-y-3">
        {plan.buckets.map((bucket) => (
          <article
            key={bucket.index}
            className={cn(
              "clinical-card p-5 space-y-3",
              bucket.over_budget && "border-[#FECACA]"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[16px] font-bold text-[#0F172A]">{bucket.label}</h3>
                  {bucket.over_budget && <StatusBadge label="[SOBRE TOPE]" tone="crit" />}
                  {bucket.index === 0 && <StatusBadge label="[QUINCENA ACTUAL]" tone="info" />}
                </div>
                <p className="text-[13px] text-[#475569] font-mono tabular-nums">
                  Pago: {formatDateOnlyEs(bucket.pay_date)} | Cubre hasta {formatDateOnlyEs(bucket.period_end)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[20px] font-bold tabular-nums text-[#0F172A]">
                  {formatCurrencyMxn(bucket.total_cost)}
                </p>
                {bucket.baseline_total_cost !== bucket.total_cost && (
                  <p className="text-[12px] text-[#64748B] tabular-nums line-through">
                    Sin optimizar {formatCurrencyMxn(bucket.baseline_total_cost)}
                  </p>
                )}
              </div>
            </div>

            <div
              className="h-2 rounded-full bg-[#E2E8F0] overflow-hidden"
              aria-hidden="true"
            >
              <div
                className={cn("h-full", bucket.over_budget ? "bg-[#DC2626]" : "bg-[#0E7490]")}
                style={{ width: `${peakBucket > 0 ? (bucket.total_cost / peakBucket) * 100 : 0}%` }}
              />
            </div>

            {bucket.purchases.length === 0 && bucket.events.length === 0 ? (
              <p className="text-[13px] text-[#64748B]">Sin compras ni eventos programados.</p>
            ) : (
              <div className="space-y-2">
                {bucket.purchases.map((p) => (
                  <div
                    key={p.plan_item_id}
                    className={cn(
                      "p-3 rounded-[6px] border flex flex-wrap items-center justify-between gap-3",
                      p.urgent_before_payday
                        ? "border-[#FECACA] bg-[#FEF2F2]"
                        : "border-[#E2E8F0] bg-[#F8FAFC]"
                    )}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[14px] text-[#0F172A]">
                          {p.medication_name}
                        </span>
                        <span className="text-[13px] text-[#475569]">
                          {p.packages} caja{p.packages === 1 ? "" : "s"} x {formatCurrencyMxn(p.package_price)}
                        </span>
                        {p.urgent_before_payday && (
                          <StatusBadge label="[URGENTE ANTES DEL PAGO]" tone="crit" />
                        )}
                        {p.shifted_from_quincena_label && (
                          <StatusBadge label="[ADELANTADO]" tone="info" />
                        )}
                      </div>
                      <p className="text-[12px] text-[#475569] font-mono tabular-nums">
                        Stock al inicio {p.current_stock_at_start} | Se agota {formatDateOnlyEs(p.projected_depletion_date)} | Comprar antes de {formatDateOnlyEs(p.recommended_deadline_date)}
                      </p>
                      {p.optimization_reason && (
                        <p className="text-[12px] text-[#0E7490]">{p.optimization_reason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[14px] tabular-nums text-[#0F172A]">
                        {formatCurrencyMxn(p.total_cost)}
                      </span>
                      <IconActionButton
                        icon={PackagePlus}
                        label={`Registrar compra realizada de ${p.medication_name}`}
                        tone="success"
                        onClick={() => openPurchase(p, bucket)}
                      />
                    </div>
                  </div>
                ))}
                {bucket.events.map((ev) => (
                  <div
                    key={ev.event_id}
                    className="p-3 rounded-[6px] border border-[#E2E8F0] bg-white flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={EVENT_CATEGORY_TAG[ev.category]} tone="neutral" />
                      <span className="font-semibold text-[14px] text-[#0F172A]">{ev.title}</span>
                      <span className="text-[12px] text-[#475569] font-mono tabular-nums">
                        {formatDateOnlyEs(ev.event_date)}
                      </span>
                      {ev.date_is_estimated && <StatusBadge label="[FECHA ESTIMADA]" tone="warn" />}
                    </div>
                    <span className="font-mono font-bold text-[14px] tabular-nums text-[#0F172A]">
                      {formatCurrencyMxn(ev.estimated_cost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {/* Bitacora de gastos */}
      <section className="clinical-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[16px] font-bold text-[#0F172A]">
            Bitacora de Gastos ({snapshot.recent_expenses.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["ALL", "Todos"],
                ["PAID", "Pagados"],
                ["PLANNED", "Planeados"],
                ["CANCELLED", "Cancelados"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setExpenseFilter(key)}
                className={cn(
                  "px-3 py-1.5 rounded-[4px] border text-[13px] font-medium cursor-pointer",
                  expenseFilter === key
                    ? "bg-[#0E7490] border-[#0E7490] text-white"
                    : "bg-white border-[#CBD5E1] text-[#334155] hover:bg-[#F8FAFC]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredExpenses.length === 0 ? (
          <p className="text-[14px] text-[#475569] py-4 text-center">
            Sin gastos registrados con este filtro.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[#475569] border-b border-[#E2E8F0]">
                  <th className="py-2 pr-3 font-semibold">Fecha</th>
                  <th className="py-2 pr-3 font-semibold">Concepto</th>
                  <th className="py-2 pr-3 font-semibold">Categoria</th>
                  <th className="py-2 pr-3 font-semibold">Estado</th>
                  <th className="py-2 pr-3 font-semibold text-right">Monto</th>
                  <th className="py-2 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((exp) => (
                  <tr key={exp.id} className="border-b border-[#F1F5F9] align-middle">
                    <td className="py-2 pr-3 font-mono tabular-nums whitespace-nowrap">
                      {formatDateOnlyEs(exp.expense_date)}
                    </td>
                    <td className="py-2 pr-3">
                      <p className="font-semibold text-[#0F172A]">{exp.title}</p>
                      <p className="text-[12px] text-[#64748B]">
                        {[exp.provider_or_pharmacy, exp.payment_method, exp.quincena_label]
                          .filter(Boolean)
                          .join(" | ")}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge label={EXPENSE_CATEGORY_TAG[exp.category]} tone="neutral" />
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge
                        label={EXPENSE_STATUS_TAG[exp.status]}
                        tone={exp.status === "PAID" ? "ok" : exp.status === "PLANNED" ? "info" : "warn"}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right font-mono font-bold tabular-nums text-[#0F172A]">
                      {formatCurrencyMxn(exp.amount)}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-2">
                        <IconActionButton
                          icon={Edit3}
                          label={`Editar gasto ${exp.title}`}
                          tone="neutral"
                          onClick={() => openEditExpense(exp)}
                        />
                        {isAdmin &&
                          (confirmDeleteId === exp.id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyKey === `del:${exp.id}`}
                                onClick={async () => {
                                  setBusyKey(`del:${exp.id}`);
                                  try {
                                    await onDeleteExpense(exp.id);
                                    setConfirmDeleteId(null);
                                  } catch {
                                    // Toast global
                                  } finally {
                                    setBusyKey(null);
                                  }
                                }}
                                className="clinical-btn px-3 bg-[#991B1B] text-white text-[12px] font-bold"
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white text-[#334155] text-[12px]"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <IconActionButton
                              icon={Trash2}
                              label={`Eliminar gasto ${exp.title}`}
                              tone="danger"
                              onClick={() => setConfirmDeleteId(exp.id)}
                            />
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal Configuracion */}
      <ClinicalModal
        open={settingsOpen}
        onClose={() => !savingSettings && setSettingsOpen(false)}
        title="Configuracion del Plan Quincenal"
        subtitle="Dias de cobro de salario, topes de gasto y horizonte de planeacion."
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSettingsSubmit} className="space-y-4">
          {settingsError && (
            <div role="alert" className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{settingsError}</span>
            </div>
          )}
          <div>
            <label htmlFor="fs-type" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
              Esquema de pago
            </label>
            <select
              id="fs-type"
              value={sPayType}
              onChange={(e) => {
                const next = e.target.value as PayScheduleType;
                setSPayType(next);
                if (next === "QUINCENAL_15_30") {
                  setSPayday1("15");
                  setSPayday2("30");
                } else if (next === "QUINCENAL_1_15") {
                  setSPayday1("1");
                  setSPayday2("15");
                }
              }}
              className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
            >
              {PAY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PAY_SCHEDULE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {sPayType !== "CATORCENAL" ? (
              <>
                <div>
                  <label htmlFor="fs-p1" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                    Dia de pago 1
                  </label>
                  <input id="fs-p1" type="number" min="1" max="31" value={sPayday1} onChange={(e) => setSPayday1(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
                </div>
                <div>
                  <label htmlFor="fs-p2" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                    Dia de pago 2
                  </label>
                  <input id="fs-p2" type="number" min="1" max="31" value={sPayday2} onChange={(e) => setSPayday2(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <label htmlFor="fs-anchor" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                  Fecha de un pago conocido (ancla)
                </label>
                <input id="fs-anchor" type="date" value={sAnchor} onChange={(e) => setSAnchor(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
              </div>
            )}
            <div>
              <label htmlFor="fs-buffer" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Colchon (dias)
              </label>
              <input id="fs-buffer" type="number" min="1" max="60" value={sBuffer} onChange={(e) => setSBuffer(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
            <div>
              <label htmlFor="fs-qcap" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Tope por quincena (MXN)
              </label>
              <input id="fs-qcap" type="number" step="0.01" min="0" value={sQCap} onChange={(e) => setSQCap(e.target.value)} placeholder="Sin tope" className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
            <div>
              <label htmlFor="fs-mcap" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Tope mensual (MXN)
              </label>
              <input id="fs-mcap" type="number" step="0.01" min="0" value={sMCap} onChange={(e) => setSMCap(e.target.value)} placeholder="Sin tope" className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
            <div>
              <label htmlFor="fs-horizon" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Horizonte (quincenas)
              </label>
              <input id="fs-horizon" type="number" min="2" max="12" value={sHorizon} onChange={(e) => setSHorizon(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
            <input type="checkbox" checked={sIncludeEvents} onChange={(e) => setSIncludeEvents(e.target.checked)} className="w-4 h-4 accent-[#0E7490]" />
            Incluir costos estimados de citas e inyecciones en el plan
          </label>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button type="button" onClick={() => setSettingsOpen(false)} className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]">
              Cancelar
            </button>
            <button type="submit" disabled={savingSettings} className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold">
              {savingSettings ? "Recalculando..." : "Guardar y Recalcular"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal Gasto */}
      <ClinicalModal
        open={expenseOpen}
        onClose={() => !savingExpense && setExpenseOpen(false)}
        title={editingExpense ? `Editar Gasto: ${editingExpense.title}` : "Registrar Gasto Medico"}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleExpenseSubmit} className="space-y-4">
          {expenseError && (
            <div role="alert" className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{expenseError}</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label htmlFor="ex-title" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Concepto *
              </label>
              <input id="ex-title" type="text" required value={eTitle} onChange={(e) => setETitle(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="ex-category" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Categoria
              </label>
              <select id="ex-category" value={eCategory} onChange={(e) => setECategory(e.target.value as ExpenseCategory)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EXPENSE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ex-status" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Estado
              </label>
              <select id="ex-status" value={eStatus} onChange={(e) => setEStatus(e.target.value as ExpenseStatus)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white">
                <option value="PAID">Pagado</option>
                <option value="PLANNED">Planeado</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
            </div>
            <div>
              <label htmlFor="ex-amount" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Monto (MXN) *
              </label>
              <input id="ex-amount" type="number" step="0.01" min="0" required value={eAmount} onChange={(e) => setEAmount(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
            <div>
              <label htmlFor="ex-date" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Fecha *
              </label>
              <input id="ex-date" type="date" required value={eDate} onChange={(e) => setEDate(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
            <div>
              <label htmlFor="ex-med" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Medicamento vinculado
              </label>
              <select id="ex-med" value={eMedId} onChange={(e) => setEMedId(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white">
                <option value="">Ninguno</option>
                {snapshot.medications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ex-event" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Evento vinculado
              </label>
              <select id="ex-event" value={eEventId} onChange={(e) => setEEventId(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white">
                <option value="">Ninguno</option>
                {[...snapshot.upcoming_events, ...snapshot.completed_events].map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ex-provider" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Farmacia / Proveedor
              </label>
              <input id="ex-provider" type="text" value={eProvider} onChange={(e) => setEProvider(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="ex-method" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Metodo de pago
              </label>
              <input id="ex-method" type="text" value={eMethod} onChange={(e) => setEMethod(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="ex-quincena" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Quincena (etiqueta)
              </label>
              <input id="ex-quincena" type="text" value={eQuincena} onChange={(e) => setEQuincena(e.target.value)} placeholder="Automatica si se deja vacia" className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
          </div>
          <div>
            <label htmlFor="ex-notes" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
              Notas
            </label>
            <textarea id="ex-notes" rows={2} value={eNotes} onChange={(e) => setENotes(e.target.value)} className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button type="button" onClick={() => setExpenseOpen(false)} className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]">
              Cancelar
            </button>
            <button type="submit" disabled={savingExpense} className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold">
              {savingExpense ? "Guardando..." : editingExpense ? "Guardar Cambios" : "Registrar Gasto"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal Ejecutar Compra Planeada */}
      <ClinicalModal
        open={Boolean(purchaseItem)}
        onClose={() => !savingPurchase && setPurchaseItem(null)}
        title={`Registrar Compra: ${purchaseItem?.item.medication_name ?? ""}`}
        subtitle={`Suma el inventario y registra el gasto en ${purchaseItem?.bucket.label ?? "la quincena"}.`}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handlePurchaseSubmit} className="space-y-4">
          {purchaseError && (
            <div role="alert" className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]">
              {purchaseError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="pp-packages" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Cajas compradas *
              </label>
              <input
                id="pp-packages"
                type="number"
                step="any"
                min="0.1"
                required
                value={pPackages}
                onChange={(e) => {
                  setPPackages(e.target.value);
                  const price = Number(pPrice);
                  const pk = Number(e.target.value);
                  if (Number.isFinite(price) && Number.isFinite(pk)) {
                    setPTotal(String(Number((price * pk).toFixed(2))));
                  }
                }}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
            <div>
              <label htmlFor="pp-price" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Precio por caja (MXN)
              </label>
              <input
                id="pp-price"
                type="number"
                step="0.01"
                min="0"
                value={pPrice}
                onChange={(e) => {
                  setPPrice(e.target.value);
                  const price = Number(e.target.value);
                  const pk = Number(pPackages);
                  if (Number.isFinite(price) && Number.isFinite(pk)) {
                    setPTotal(String(Number((price * pk).toFixed(2))));
                  }
                }}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
            <div>
              <label htmlFor="pp-total" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Total pagado (MXN) *
              </label>
              <input id="pp-total" type="number" step="0.01" min="0" required value={pTotal} onChange={(e) => setPTotal(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
            <div>
              <label htmlFor="pp-date" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Fecha de compra
              </label>
              <input id="pp-date" type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
            <div>
              <label htmlFor="pp-provider" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Farmacia
              </label>
              <input id="pp-provider" type="text" value={pProvider} onChange={(e) => setPProvider(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="pp-method" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Metodo de pago
              </label>
              <input id="pp-method" type="text" value={pMethod} onChange={(e) => setPMethod(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
          </div>
          <div>
            <label htmlFor="pp-notes" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
              Notas
            </label>
            <input id="pp-notes" type="text" value={pNotes} onChange={(e) => setPNotes(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button type="button" onClick={() => setPurchaseItem(null)} className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]">
              Cancelar
            </button>
            <button type="submit" disabled={savingPurchase} className="clinical-btn px-5 bg-[#065F46] hover:bg-[#047857] text-white text-[14px] font-semibold">
              {savingPurchase ? "Registrando..." : "Confirmar Compra"}
            </button>
          </div>
        </form>
      </ClinicalModal>
    </div>
  );
}
