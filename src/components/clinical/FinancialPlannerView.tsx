"use client";

import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Edit3,
  FileWarning,
  Plus,
  Settings,
  ShoppingBag,
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
} from "@/lib/types/clinical";
import {
  EVENT_CATEGORY_TAG,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_TAG,
  EXPENSE_STATUS_TAG,
  PAY_SCHEDULE_LABEL,
} from "@/lib/clinical-labels";
import { cn, formatCurrencyMxn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

interface FinancialPlannerViewProps {
  snapshot: CommandCenterSnapshot;
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
  onCreateExpense: (payload: {
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
  }) => Promise<void>;
  onUpdateExpense: (
    expenseId: string,
    payload: {
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
  ) => Promise<void>;
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

export function FinancialPlannerView({
  snapshot,
  onUpdateSettings,
  onCreateExpense,
  onUpdateExpense,
  onDeleteExpense,
  onExecutePlannedPurchase,
  onNavigateToInventory,
}: FinancialPlannerViewProps) {
  const plan = snapshot.financial_plan;
  const settings = snapshot.financial_settings;

  // Configuracion de nomina quincenal
  const [showSettings, setShowSettings] = useState(false);
  const [payScheduleType, setPayScheduleType] = useState<PayScheduleType>(
    settings.pay_schedule_type
  );
  const [payday1, setPayday1] = useState(String(settings.payday_1));
  const [payday2, setPayday2] = useState(String(settings.payday_2));
  const [anchorDate, setAnchorDate] = useState(
    settings.biweekly_anchor_date ?? new Date().toISOString().slice(0, 10)
  );
  const [quincenalCap, setQuincenalCap] = useState(
    settings.quincenal_budget_cap !== null
      ? String(settings.quincenal_budget_cap)
      : ""
  );
  const [monthlyCap, setMonthlyCap] = useState(
    settings.monthly_budget_cap !== null ? String(settings.monthly_budget_cap) : ""
  );
  const [safetyBuffer, setSafetyBuffer] = useState(
    String(settings.safety_buffer_days)
  );
  const [horizonQuincenas, setHorizonQuincenas] = useState(
    String(settings.planning_horizon_quincenas)
  );
  const [includeEvents, setIncludeEvents] = useState(
    settings.include_events_in_plan
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Ejecutar compra planeada desde tarjeta de quincena
  const [executingPurchaseId, setExecutingPurchaseId] = useState<string | null>(
    null
  );
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchasePackages, setPurchasePackages] = useState("1");
  const [purchasePharmacy, setPurchasePharmacy] = useState("");
  const [purchaseMethod, setPurchaseMethod] = useState("Debito / Nomina");
  const [purchaseBusy, setPurchaseBusy] = useState(false);

  // CRUD de Bitacora de Gastos Reales
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expTitle, setExpTitle] = useState("");
  const [expCategory, setExpCategory] = useState<ExpenseCategory>("MEDICATION");
  const [expStatus, setExpStatus] = useState<ExpenseStatus>("PAID");
  const [expAmount, setExpAmount] = useState("");
  const [expDate, setExpDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [expMedId, setExpMedId] = useState("");
  const [expEventId, setExpEventId] = useState("");
  const [expProvider, setExpProvider] = useState("");
  const [expMethod, setExpMethod] = useState("Tarjeta / Nomina");
  const [expNotes, setExpNotes] = useState("");
  const [savingExpense, setSavingExpense] = useState(false);

  const [filterCategory, setFilterCategory] = useState<string>("ALL");
  const [confirmDeleteExpId, setConfirmDeleteExpId] = useState<string | null>(
    null
  );

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await onUpdateSettings({
        currency: settings.currency || "MXN",
        pay_schedule_type: payScheduleType,
        payday_1: Number(payday1) || 15,
        payday_2: Number(payday2) || 30,
        biweekly_anchor_date:
          payScheduleType === "CATORCENAL" ? anchorDate || null : null,
        quincenal_budget_cap:
          quincenalCap.trim() !== "" ? Number(quincenalCap) : null,
        monthly_budget_cap:
          monthlyCap.trim() !== "" ? Number(monthlyCap) : null,
        safety_buffer_days: Number(safetyBuffer) || 7,
        planning_horizon_quincenas: Number(horizonQuincenas) || 6,
        include_events_in_plan: includeEvents,
      });
      setShowSettings(false);
    } finally {
      setSavingSettings(false);
    }
  }

  function startExecutePurchase(p: PlannedMedicationPurchase) {
    setExecutingPurchaseId(p.plan_item_id);
    setPurchasePackages(String(p.packages));
    setPurchaseAmount(String(p.total_cost));
    setPurchasePharmacy(p.preferred_pharmacy ?? "");
  }

  async function submitExecutePurchase(
    p: PlannedMedicationPurchase,
    quincenaLabel: string
  ) {
    const amt = Number(purchaseAmount);
    const pkgs = Number(purchasePackages);
    if (!Number.isFinite(amt) || amt < 0 || !Number.isFinite(pkgs) || pkgs <= 0) {
      return;
    }
    setPurchaseBusy(true);
    try {
      await onExecutePlannedPurchase({
        medication_id: p.medication_id,
        packages: pkgs,
        package_price: pkgs > 0 ? Number((amt / pkgs).toFixed(2)) : p.package_price,
        total_amount: amt,
        purchase_date: new Date().toISOString().slice(0, 10),
        quincena_label: quincenaLabel,
        provider_or_pharmacy: purchasePharmacy.trim() || null,
        payment_method: purchaseMethod.trim() || null,
        notes: `Compra ejecutada desde plan quincenal (${quincenaLabel}).`,
      });
      setExecutingPurchaseId(null);
    } finally {
      setPurchaseBusy(false);
    }
  }

  function resetExpenseForm() {
    setEditingExpenseId(null);
    setExpTitle("");
    setExpCategory("MEDICATION");
    setExpStatus("PAID");
    setExpAmount("");
    setExpDate(new Date().toISOString().slice(0, 10));
    setExpMedId("");
    setExpEventId("");
    setExpProvider("");
    setExpMethod("Tarjeta / Nomina");
    setExpNotes("");
  }

  function startEditExpense(exp: MedicalExpense) {
    setEditingExpenseId(exp.id);
    setExpTitle(exp.title);
    setExpCategory(exp.category);
    setExpStatus(exp.status);
    setExpAmount(String(exp.amount));
    setExpDate(exp.expense_date.slice(0, 10));
    setExpMedId(exp.medication_id ?? "");
    setExpEventId(exp.clinical_event_id ?? "");
    setExpProvider(exp.provider_or_pharmacy ?? "");
    setExpMethod(exp.payment_method ?? "");
    setExpNotes(exp.notes ?? "");
    setShowExpenseForm(true);
  }

  async function handleSaveExpense(e: FormEvent) {
    e.preventDefault();
    const amt = Number(expAmount);
    if (!expTitle.trim() || !Number.isFinite(amt) || amt < 0) return;

    const payload = {
      title: expTitle.trim(),
      category: expCategory,
      status: expStatus,
      amount: amt,
      expense_date: expDate,
      quincena_label: null,
      medication_id: expMedId || null,
      clinical_event_id: expEventId || null,
      provider_or_pharmacy: expProvider.trim() || null,
      payment_method: expMethod.trim() || null,
      notes: expNotes.trim() || null,
    };

    setSavingExpense(true);
    try {
      if (editingExpenseId) {
        await onUpdateExpense(editingExpenseId, payload);
      } else {
        await onCreateExpense(payload);
      }
      resetExpenseForm();
      setShowExpenseForm(false);
    } finally {
      setSavingExpense(false);
    }
  }

  const maxBucketScale = Math.max(
    settings.quincenal_budget_cap ?? 0,
    plan.summary.baseline_peak_quincena,
    plan.summary.optimized_peak_quincena,
    1000
  );

  const visibleExpenses =
    filterCategory === "ALL"
      ? snapshot.recent_expenses
      : snapshot.recent_expenses.filter((e) => e.category === filterCategory);

  return (
    <div className="space-y-6 clinical-enter">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-[#0F172A]">
            Finanzas Clinicas y Optimizador de Compras Quincenales
          </h2>
          <p className="text-[14px] text-[#475569]">
            Distribucion inteligente de compras de medicamentos segun fechas de
            pago quincenal ({PAY_SCHEDULE_LABEL[settings.pay_schedule_type]}) para
            suavizar picos mensuales.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            <Settings
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Configurar Quincenas y Tope
          </button>

          <button
            type="button"
            onClick={() => {
              if (showExpenseForm && !editingExpenseId) {
                setShowExpenseForm(false);
              } else {
                resetExpenseForm();
                setShowExpenseForm(true);
              }
            }}
            className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            {showExpenseForm ? "Cerrar Gasto" : "Registrar Gasto Real"}
          </button>
        </div>
      </div>

      {/* KPIs Financieros */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="clinical-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#475569]">
              Costo Mensual Medicinas (30d)
            </span>
            <ShoppingBag
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[24px] font-bold text-[#0F172A] tabular-nums">
            {formatCurrencyMxn(plan.summary.monthly_run_rate_meds)}
          </p>
          <p className="mt-1 text-[13px] text-[#475569] tabular-nums">
            Eventos prorrateados:{" "}
            {formatCurrencyMxn(plan.summary.monthly_run_rate_events)}/mes
          </p>
        </div>

        <div className="clinical-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#475569]">
              Carga Mensual Total Estimada
            </span>
            <CalendarRange
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[24px] font-bold text-[#0F172A] tabular-nums">
            {formatCurrencyMxn(plan.summary.monthly_run_rate_total)}
          </p>
          <p className="mt-1 text-[13px] text-[#475569] tabular-nums">
            Promedio quincenal:{" "}
            {formatCurrencyMxn(plan.summary.average_quincenal_planned)}
          </p>
        </div>

        <div className="clinical-card p-4 border-[#A7F3D0] bg-[#ECFDF5]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#065F46]">
              Suavizado de Pico Quincenal
            </span>
            <TrendingDown
              className="w-4 h-4 text-[#065F46]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[24px] font-bold text-[#065F46] tabular-nums">
            {formatCurrencyMxn(plan.summary.optimized_peak_quincena)}
          </p>
          <p className="mt-1 text-[13px] text-[#065F46] tabular-nums">
            Sin optimizar: {formatCurrencyMxn(plan.summary.baseline_peak_quincena)}{" "}
            {plan.summary.peak_reduction_mxn > 0
              ? `(-${plan.summary.peak_reduction_pct}% / -${formatCurrencyMxn(
                  plan.summary.peak_reduction_mxn
                )})`
              : `(${plan.summary.shifted_purchases_count} mov.)`}
          </p>
        </div>

        <div className="clinical-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#475569]">
              Gasto Real Registrado (Mes)
            </span>
            <Wallet
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[24px] font-bold text-[#0F172A] tabular-nums">
            {formatCurrencyMxn(plan.summary.paid_current_month_mxn)}
          </p>
          <p className="mt-1 text-[13px] text-[#475569] tabular-nums">
            Acumulado historico: {formatCurrencyMxn(plan.summary.paid_total_mxn)}
          </p>
        </div>
      </section>

      {/* Alertas: Datos pendientes + Fondo de reserva */}
      {plan.incomplete_pricing_medications.length > 0 && (
        <section className="border border-[#FDE68A] bg-[#FFFBEB] rounded-[6px] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <FileWarning
              className="w-5 h-5 text-[#92400E] shrink-0 mt-0.5"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div>
              <h3 className="text-[15px] font-bold text-[#92400E]">
                [NO INCLUIDOS EN PRESUPUESTO] Faltan costos o inventario en{" "}
                {plan.incomplete_pricing_medications.length} medicamento(s)
              </h3>
              <ul className="text-[13px] text-[#78350F] mt-1 space-y-0.5">
                {plan.incomplete_pricing_medications.map((m) => (
                  <li key={m.id}>
                    <strong>{m.name}</strong>: falta{" "}
                    {m.missing_fields.join(", ")}.
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            onClick={onNavigateToInventory}
            className="clinical-btn px-3.5 bg-white border border-[#F59E0B] text-[#92400E] text-[14px] font-bold"
          >
            Capturar en Inventario
          </button>
        </section>
      )}

      {plan.reserve_alerts.length > 0 && (
        <section className="border border-[#A5F3FC] bg-[#ECFEFF] rounded-[6px] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="w-4 h-4 text-[#164E63]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h3 className="text-[15px] font-bold text-[#164E63]">
              Recomendaciones de Fondo de Reserva Quincenal (Consultas y Estudios)
            </h3>
          </div>
          <ul className="space-y-1 text-[14px] text-[#164E63]">
            {plan.reserve_alerts.map((al) => (
              <li key={al.quincena_label}>{al.message}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Configurador de Nomina Quincenal */}
      {showSettings && (
        <form
          onSubmit={handleSaveSettings}
          className="clinical-card p-5 space-y-4 border-[#A5F3FC]"
        >
          <h3 className="text-[16px] font-bold text-[#0F172A] border-b border-[#E2E8F0] pb-2.5">
            Configuracion de Fechas de Pago Quincenal y Presupuesto
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="fin-sched-type"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Esquema de pago (salario)
              </label>
              <select
                id="fin-sched-type"
                value={payScheduleType}
                onChange={(e) =>
                  setPayScheduleType(e.target.value as PayScheduleType)
                }
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
              >
                <option value="QUINCENAL_15_30">
                  Quincenal: Dias 15 y 30 (o ultimo dia de mes)
                </option>
                <option value="QUINCENAL_1_15">Quincenal: Dias 1 y 15</option>
                <option value="CUSTOM_DAYS">
                  Quincenal: Dias del mes personalizados
                </option>
                <option value="CATORCENAL">Catorcenal: Cada 14 dias</option>
              </select>
            </div>

            {payScheduleType === "CUSTOM_DAYS" && (
              <>
                <div>
                  <label
                    htmlFor="fin-p1"
                    className="block text-[13px] font-medium text-[#0F172A] mb-1"
                  >
                    Primer dia de pago
                  </label>
                  <input
                    id="fin-p1"
                    type="number"
                    min="1"
                    max="31"
                    value={payday1}
                    onChange={(e) => setPayday1(e.target.value)}
                    className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="fin-p2"
                    className="block text-[13px] font-medium text-[#0F172A] mb-1"
                  >
                    Segundo dia de pago
                  </label>
                  <input
                    id="fin-p2"
                    type="number"
                    min="1"
                    max="31"
                    value={payday2}
                    onChange={(e) => setPayday2(e.target.value)}
                    className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
                  />
                </div>
              </>
            )}

            {payScheduleType === "CATORCENAL" && (
              <div>
                <label
                  htmlFor="fin-anchor"
                  className="block text-[13px] font-medium text-[#0F172A] mb-1"
                >
                  Fecha base de pago catorcenal
                </label>
                <input
                  id="fin-anchor"
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="fin-qcap"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Tope ideal por quincena (MXN opc.)
              </label>
              <input
                id="fin-qcap"
                type="number"
                min="0"
                step="50"
                placeholder="Sin tope fijo"
                value={quincenalCap}
                onChange={(e) => setQuincenalCap(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="fin-mcap"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Tope mensual de referencia (MXN opc.)
              </label>
              <input
                id="fin-mcap"
                type="number"
                min="0"
                step="100"
                placeholder="Sin tope fijo"
                value={monthlyCap}
                onChange={(e) => setMonthlyCap(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="fin-buffer"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Colchon de seguridad global (dias)
              </label>
              <input
                id="fin-buffer"
                type="number"
                min="1"
                max="60"
                value={safetyBuffer}
                onChange={(e) => setSafetyBuffer(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="fin-horizon"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Horizonte (quincenas a planear)
              </label>
              <select
                id="fin-horizon"
                value={horizonQuincenas}
                onChange={(e) => setHorizonQuincenas(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[14px]"
              >
                {[4, 6, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n} quincenas ({Math.round(n / 2)} meses)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end pb-1">
              <label className="inline-flex items-center gap-2 h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] w-full bg-[#F8FAFC] text-[14px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeEvents}
                  onChange={(e) => setIncludeEvents(e.target.checked)}
                  className="w-4 h-4 accent-[#0E7490]"
                />
                Incluir citas y estudios en el balance
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingSettings}
              className="clinical-btn px-5 bg-[#0E7490] text-white text-[14px] font-bold"
            >
              {savingSettings
                ? "Recalculando plan..."
                : "Guardar y Recalcular Plan"}
            </button>
          </div>
        </form>
      )}

      {/* Plan de Compras por Quincena */}
      <section aria-labelledby="quincena-plan-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3
              id="quincena-plan-heading"
              className="text-[18px] font-bold text-[#0F172A]"
            >
              Calendario Optimizado de Compras por Quincena
            </h3>
            <p className="text-[13px] text-[#475569]">
              El motor adelanta compras hasta 2 quincenas cuando conviene para
              evitar acumular varios medicamentos caros o consultas en una sola fecha
              de pago.
            </p>
          </div>
          {settings.quincenal_budget_cap && (
            <StatusBadge
              label={`TOPE QUINCENAL: ${formatCurrencyMxn(
                settings.quincenal_budget_cap
              )}`}
              tone="info"
            />
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {plan.buckets.map((bucket) => {
            const barPct = Math.min(
              100,
              Math.round((bucket.total_cost / maxBucketScale) * 100)
            );
            return (
              <article
                key={bucket.index}
                className={cn(
                  "clinical-card p-4 space-y-3",
                  bucket.over_budget && "border-[#FECACA]"
                )}
              >
                <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[#E2E8F0] pb-2.5">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-[16px] font-bold text-[#0F172A]">
                        {bucket.label}
                      </h4>
                      {bucket.over_budget && (
                        <StatusBadge label="[EXCEDE TOPE]" tone="crit" />
                      )}
                      {bucket.purchases.some((p) => p.shifted_from_quincena_label) && (
                        <StatusBadge label="[SUAVIZADO]" tone="ok" />
                      )}
                    </div>
                    <p className="font-mono text-[12px] text-[#64748B]">
                      Cobertura: {bucket.pay_date} al {bucket.period_end}
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="block font-mono text-[20px] font-bold text-[#0F172A] tabular-nums">
                      {formatCurrencyMxn(bucket.total_cost)}
                    </span>
                    {bucket.baseline_total_cost !== bucket.total_cost && (
                      <span className="block font-mono text-[12px] text-[#475569] tabular-nums">
                        Sin optimizar:{" "}
                        {formatCurrencyMxn(bucket.baseline_total_cost)}
                      </span>
                    )}
                  </div>
                </header>

                <div className="space-y-1">
                  <div className="flex justify-between text-[12px] font-mono text-[#475569] tabular-nums">
                    <span>
                      Medicinas: {formatCurrencyMxn(bucket.medications_subtotal)}
                    </span>
                    <span>
                      Citas/Estudios: {formatCurrencyMxn(bucket.events_subtotal)}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full",
                        bucket.over_budget ? "bg-[#DC2626]" : "bg-[#0E7490]"
                      )}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>

                {bucket.purchases.length === 0 && bucket.events.length === 0 ? (
                  <p className="text-[13px] text-[#64748B] py-2">
                    Quincena libre de compras y consultas programadas.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {bucket.purchases.map((p) => {
                      const isExec = executingPurchaseId === p.plan_item_id;
                      return (
                        <div
                          key={p.plan_item_id}
                          className={cn(
                            "p-2.5 rounded-[6px] border text-[13px] space-y-2",
                            p.urgent_before_payday
                              ? "bg-[#FEF2F2] border-[#FECACA]"
                              : "bg-[#F8FAFC] border-[#E2E8F0]"
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="space-y-0.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-bold text-[#0F172A]">
                                  {p.medication_name}
                                </span>
                                <StatusBadge
                                  label={`${p.packages} env. (${p.units_per_package} u.)`}
                                  tone="neutral"
                                />
                                {p.urgent_before_payday && (
                                  <StatusBadge
                                    label="[URGENTE ANTES DEL PAGO]"
                                    tone="crit"
                                  />
                                )}
                                {p.shifted_from_quincena_label && (
                                  <StatusBadge
                                    label="[ADELANTADA]"
                                    tone="ok"
                                  />
                                )}
                              </div>
                              <p className="font-mono text-[12px] text-[#475569] tabular-nums">
                                Agota: {p.projected_depletion_date} | Comprar
                                antes: {p.recommended_deadline_date}
                              </p>
                              {p.optimization_reason && (
                                <p className="text-[12px] text-[#065F46]">
                                  {p.optimization_reason}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-[14px] text-[#0F172A] tabular-nums">
                                {formatCurrencyMxn(p.total_cost)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  isExec
                                    ? setExecutingPurchaseId(null)
                                    : startExecutePurchase(p)
                                }
                                className="px-2.5 h-[36px] rounded-[6px] bg-[#0E7490] hover:bg-[#155E75] text-white text-[12px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <CheckCircle2
                                  className="w-3.5 h-3.5"
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                />
                                {isExec ? "Cerrar" : "Registrar Compra"}
                              </button>
                            </div>
                          </div>

                          {isExec && (
                            <div className="pt-2 border-t border-[#CBD5E1] grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                              <div>
                                <label className="block text-[11px] text-[#334155]">
                                  Envases comprados
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={purchasePackages}
                                  onChange={(e) => {
                                    setPurchasePackages(e.target.value);
                                    const n = Number(e.target.value);
                                    if (Number.isFinite(n) && n > 0) {
                                      setPurchaseAmount(
                                        String(
                                          Number((n * p.package_price).toFixed(2))
                                        )
                                      );
                                    }
                                  }}
                                  className="w-full h-[36px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[13px]"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-[#334155]">
                                  Monto real pagado (MXN)
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={purchaseAmount}
                                  onChange={(e) =>
                                    setPurchaseAmount(e.target.value)
                                  }
                                  className="w-full h-[36px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[13px]"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-[#334155]">
                                  Farmacia / Metodo
                                </label>
                                <input
                                  type="text"
                                  placeholder="Farmacia"
                                  value={purchasePharmacy}
                                  onChange={(e) =>
                                    setPurchasePharmacy(e.target.value)
                                  }
                                  className="w-full h-[36px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white text-[13px]"
                                />
                              </div>
                              <div className="sm:col-span-2">
                                <input
                                  type="text"
                                  placeholder="Metodo de pago (ej. Debito / Efectivo)"
                                  value={purchaseMethod}
                                  onChange={(e) =>
                                    setPurchaseMethod(e.target.value)
                                  }
                                  className="w-full h-[36px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white text-[13px]"
                                />
                              </div>
                              <button
                                type="button"
                                disabled={purchaseBusy}
                                onClick={() =>
                                  submitExecutePurchase(p, bucket.label)
                                }
                                className="h-[36px] px-3 rounded-[6px] bg-[#065F46] text-white text-[12px] font-bold"
                              >
                                {purchaseBusy
                                  ? "Aplicando..."
                                  : "Confirmar + Sumar Stock"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {bucket.events.map((ev) => (
                      <div
                        key={ev.event_id}
                        className="p-2.5 rounded-[6px] border border-[#A5F3FC] bg-[#ECFEFF] flex items-center justify-between gap-2 text-[13px]"
                      >
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <StatusBadge
                              label={EVENT_CATEGORY_TAG[ev.category]}
                              tone="info"
                            />
                            <span className="font-bold text-[#0F172A]">
                              {ev.title}
                            </span>
                            {ev.date_is_estimated && (
                              <StatusBadge label="[FECHA ESTIMADA]" tone="warn" />
                            )}
                          </div>
                          <p className="font-mono text-[12px] text-[#164E63]">
                            Fecha: {ev.event_date}
                            {ev.specialist_or_center
                              ? ` | ${ev.specialist_or_center}`
                              : ""}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-[14px] text-[#164E63] tabular-nums shrink-0">
                          {formatCurrencyMxn(ev.estimated_cost)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* Formulario Crear / Editar Gasto Real */}
      {showExpenseForm && (
        <form
          onSubmit={handleSaveExpense}
          className="clinical-card p-5 space-y-4 border-[#A5F3FC]"
        >
          <h3 className="text-[16px] font-bold text-[#0F172A] border-b border-[#E2E8F0] pb-2.5">
            {editingExpenseId
              ? "Editar Registro de Gasto Medico"
              : "Registrar Nuevo Gasto Medico o Compra"}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label
                htmlFor="exp-title"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Concepto del gasto *
              </label>
              <input
                id="exp-title"
                type="text"
                required
                placeholder="Ej. Compra Quetiapina 100 mg / Consulta Reumatologia"
                value={expTitle}
                onChange={(e) => setExpTitle(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
              />
            </div>

            <div>
              <label
                htmlFor="exp-cat"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Categoria *
              </label>
              <select
                id="exp-cat"
                value={expCategory}
                onChange={(e) =>
                  setExpCategory(e.target.value as ExpenseCategory)
                }
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
              >
                <option value="MEDICATION">Medicamento</option>
                <option value="APPOINTMENT">Consulta Medica</option>
                <option value="LAB_TEST">Analisis Clinico</option>
                <option value="IMAGING">Imagenologia (RX / US)</option>
                <option value="PROCEDURE">Procedimiento</option>
                <option value="THERAPY">Psicologia / Terapia</option>
                <option value="INSURANCE">Seguro / Reembolso</option>
                <option value="OTHER">Otro Gasto Medico</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="exp-amount"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Monto (MXN) *
              </label>
              <input
                id="exp-amount"
                type="number"
                step="0.01"
                min="0"
                required
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px]"
              />
            </div>

            <div>
              <label
                htmlFor="exp-date"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Fecha del gasto *
              </label>
              <input
                id="exp-date"
                type="date"
                required
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="exp-status"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Estado
              </label>
              <select
                id="exp-status"
                value={expStatus}
                onChange={(e) => setExpStatus(e.target.value as ExpenseStatus)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
              >
                <option value="PAID">Pagado</option>
                <option value="PLANNED">Planeado</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="exp-med"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Vincular a medicamento (opcional)
              </label>
              <select
                id="exp-med"
                value={expMedId}
                onChange={(e) => setExpMedId(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
              >
                <option value="">Ninguno</option>
                {snapshot.medications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="exp-provider"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Farmacia / Especialista / Centro
              </label>
              <input
                id="exp-provider"
                type="text"
                placeholder="Ej. Farmacia del Ahorro"
                value={expProvider}
                onChange={(e) => setExpProvider(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="exp-method"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Metodo de pago
              </label>
              <input
                id="exp-method"
                type="text"
                placeholder="Tarjeta / Efectivo / Transferencia"
                value={expMethod}
                onChange={(e) => setExpMethod(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="exp-notes"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Notas o folio de recibo
              </label>
              <input
                id="exp-notes"
                type="text"
                value={expNotes}
                onChange={(e) => setExpNotes(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowExpenseForm(false);
                resetExpenseForm();
              }}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingExpense}
              className="clinical-btn px-5 bg-[#0E7490] text-white text-[14px] font-bold"
            >
              {savingExpense
                ? "Guardando..."
                : editingExpenseId
                ? "Actualizar Gasto"
                : "Guardar Gasto"}
            </button>
          </div>
        </form>
      )}

      {/* Bitacora de Gastos Reales (CRUD) */}
      <section aria-labelledby="expenses-ledger-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3
            id="expenses-ledger-heading"
            className="text-[18px] font-bold text-[#0F172A]"
          >
            Bitacora de Gastos y Compras ({visibleExpenses.length})
          </h3>

          <select
            aria-label="Filtrar gastos por categoria"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-[42px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
          >
            <option value="ALL">Todas las categorias</option>
            {Object.entries(EXPENSE_CATEGORY_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="clinical-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[13px] font-semibold text-[#475569]">
                  <th className="py-3 px-4">Fecha / Quincena</th>
                  <th className="py-3 px-3">Concepto</th>
                  <th className="py-3 px-3">Categoria / Estado</th>
                  <th className="py-3 px-3">Proveedor / Metodo</th>
                  <th className="py-3 px-3 text-right">Monto</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {visibleExpenses.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-8 px-4 text-center text-[14px] text-[#64748B]"
                    >
                      No hay gastos medicos registrados aun. Usa Registrar Compra
                      en cualquier quincena o Registrar Gasto Real.
                    </td>
                  </tr>
                ) : (
                  visibleExpenses.map((exp) => (
                    <tr key={exp.id} className="bg-white hover:bg-[#F8FAFC]">
                      <td className="py-3 px-4 font-mono text-[13px] text-[#0F172A] tabular-nums">
                        <div className="font-semibold">{exp.expense_date}</div>
                        {exp.quincena_label && (
                          <div className="text-[12px] text-[#64748B]">
                            {exp.quincena_label}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-[14px] text-[#0F172A]">
                          {exp.title}
                        </div>
                        {exp.notes && (
                          <div className="text-[12px] text-[#64748B]">
                            {exp.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge
                            label={EXPENSE_CATEGORY_TAG[exp.category]}
                            tone="info"
                          />
                          <StatusBadge
                            label={EXPENSE_STATUS_TAG[exp.status]}
                            tone={
                              exp.status === "PAID"
                                ? "ok"
                                : exp.status === "PLANNED"
                                ? "warn"
                                : "neutral"
                            }
                          />
                        </div>
                      </td>
                      <td className="py-3 px-3 text-[13px] text-[#475569]">
                        <div>{exp.provider_or_pharmacy || "--"}</div>
                        {exp.payment_method && (
                          <div className="text-[12px] text-[#64748B]">
                            {exp.payment_method}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-[15px] text-[#0F172A] tabular-nums">
                        {formatCurrencyMxn(exp.amount)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEditExpense(exp)}
                            className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[13px]"
                          >
                            <Edit3
                              className="w-3.5 h-3.5"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          </button>
                          {confirmDeleteExpId === exp.id ? (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteExpense(exp.id);
                                  setConfirmDeleteExpId(null);
                                }}
                                className="clinical-btn px-2.5 bg-[#991B1B] text-white text-[12px] font-bold"
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteExpId(null)}
                                className="clinical-btn px-2 border border-[#CBD5E1] bg-white text-[12px]"
                              >
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteExpId(exp.id)}
                              className="clinical-btn px-2.5 border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#991B1B]"
                              aria-label={`Eliminar gasto ${exp.title}`}
                            >
                              <Trash2
                                className="w-3.5 h-3.5"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
