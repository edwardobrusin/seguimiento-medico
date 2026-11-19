"use client";

import { useState, type FormEvent } from "react";
import {
  Archive,
  Clock,
  Edit3,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type {
  CommandCenterSnapshot,
  IntakeCluster,
  IntakeConstraint,
  MedFrequencyType,
  Medication,
} from "@/lib/types/clinical";
import {
  FREQUENCY_TYPE_LABEL,
  INTAKE_RULE_LABEL,
  INTAKE_RULE_TAG,
  PURCHASE_PRIORITY_TAG,
} from "@/lib/clinical-labels";
import { cn, formatCurrencyMxn, formatShortTime } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

export interface SaveMedicationPayload {
  id?: string;
  name: string;
  active_ingredient: string | null;
  presentation: string;
  units_per_package: number | null;
  package_price: number | null;
  dose_amount: number;
  current_stock: number | null;
  frequency_type: MedFrequencyType;
  frequency_value: number;
  tolerance_window_mins: number;
  intake_rule: IntakeConstraint;
  preferred_pharmacy: string | null;
  purchase_priority: number;
  safety_buffer_days: number;
  clinical_notes: string | null;
  ideal_times: string[];
}

interface MedicationsInventoryViewProps {
  snapshot: CommandCenterSnapshot;
  onSaveMedication: (payload: SaveMedicationPayload) => Promise<void>;
  onRestockMedication: (
    medicationId: string,
    quantity: number,
    options?: {
      package_price?: number | null;
      units_per_package?: number | null;
      expense_amount?: number | null;
      provider_or_pharmacy?: string | null;
      payment_method?: string | null;
      log_expense?: boolean;
    }
  ) => Promise<void>;
  onAdjustStock: (
    medicationId: string,
    exactStock: number | null,
    reason: string
  ) => Promise<void>;
  onArchiveMedication: (
    medicationId: string,
    reason: string | null
  ) => Promise<void>;
  onRestoreMedication: (medicationId: string) => Promise<void>;
  onDeleteMedication: (medicationId: string) => Promise<void>;
  onGenerateTodayLogs: () => Promise<void>;
  onCreateCluster: (payload: {
    label: string;
    anchor_time: string;
    intake_rule: IntakeConstraint;
  }) => Promise<void>;
  onUpdateCluster: (
    clusterId: string,
    payload: {
      label: string;
      anchor_time: string;
      intake_rule: IntakeConstraint;
      is_active: boolean;
    }
  ) => Promise<void>;
  onDeleteCluster: (clusterId: string) => Promise<void>;
}

type FilterTab = "active" | "incomplete" | "critical" | "archived";

function previewDailyRate(
  doseAmount: number,
  freqType: MedFrequencyType,
  freqValue: number
): number {
  if (!Number.isFinite(doseAmount) || !Number.isFinite(freqValue) || freqValue <= 0) {
    return 0;
  }
  switch (freqType) {
    case "FIXED_HOURS":
      return Number(((24 / freqValue) * doseAmount).toFixed(4));
    case "DAILY_SLOTS":
      return Number((freqValue * doseAmount).toFixed(4));
    case "INTERVAL_DAYS":
      return Number((doseAmount / freqValue).toFixed(4));
    case "INTERVAL_WEEKS":
      return Number((doseAmount / (freqValue * 7)).toFixed(4));
  }
}

export function MedicationsInventoryView({
  snapshot,
  onSaveMedication,
  onRestockMedication,
  onAdjustStock,
  onArchiveMedication,
  onRestoreMedication,
  onDeleteMedication,
  onGenerateTodayLogs,
  onCreateCluster,
  onUpdateCluster,
  onDeleteCluster,
}: MedicationsInventoryViewProps) {
  const [filterTab, setFilterTab] = useState<FilterTab>("active");
  const [searchQuery, setSearchQuery] = useState("");

  // Formulario Crear / Editar Medicamento
  const [showForm, setShowForm] = useState(false);
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [activeIngredient, setActiveIngredient] = useState("");
  const [presentation, setPresentation] = useState("Tableta");
  const [doseAmount, setDoseAmount] = useState("1");
  const [frequencyType, setFrequencyType] =
    useState<MedFrequencyType>("DAILY_SLOTS");
  const [frequencyValue, setFrequencyValue] = useState("1");
  const [toleranceMins, setToleranceMins] = useState("30");
  const [intakeRule, setIntakeRule] = useState<IntakeConstraint>("WITH_FOOD");
  const [idealTimeInput, setIdealTimeInput] = useState("08:00");
  const [clinicalNotes, setClinicalNotes] = useState("");

  // Campos diferibles / financieros
  const [stockPending, setStockPending] = useState(false);
  const [currentStock, setCurrentStock] = useState("30");
  const [pkgPending, setPkgPending] = useState(false);
  const [unitsPerPackage, setUnitsPerPackage] = useState("30");
  const [pricePending, setPricePending] = useState(false);
  const [packagePrice, setPackagePrice] = useState("");
  const [preferredPharmacy, setPreferredPharmacy] = useState("");
  const [purchasePriority, setPurchasePriority] = useState("1");
  const [safetyBufferDays, setSafetyBufferDays] = useState("7");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Acciones por fila
  const [restockId, setRestockId] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState("30");
  const [restockPrice, setRestockPrice] = useState("");
  const [restockPkgUnits, setRestockPkgUnits] = useState("");
  const [restockPharmacy, setRestockPharmacy] = useState("");
  const [restockLogExpense, setRestockLogExpense] = useState(true);

  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjustStockVal, setAdjustStockVal] = useState("0");
  const [adjustMarkPending, setAdjustMarkPending] = useState(false);
  const [adjustReason, setAdjustReason] = useState("Conteo fisico");

  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");

  const [confirmDeleteMedId, setConfirmDeleteMedId] = useState<string | null>(
    null
  );

  // Gestion de Clusters Horarios
  const [showClusterManager, setShowClusterManager] = useState(false);
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);
  const [clusterLabel, setClusterLabel] = useState("");
  const [clusterTime, setClusterTime] = useState("08:00");
  const [clusterRule, setClusterRule] = useState<IntakeConstraint>("WITH_FOOD");
  const [confirmDeleteClusterId, setConfirmDeleteClusterId] = useState<
    string | null
  >(null);

  const computedRate = previewDailyRate(
    Number(doseAmount),
    frequencyType,
    Number(frequencyValue)
  );

  function resetForm() {
    setEditingMedId(null);
    setName("");
    setActiveIngredient("");
    setPresentation("Tableta");
    setDoseAmount("1");
    setFrequencyType("DAILY_SLOTS");
    setFrequencyValue("1");
    setToleranceMins("30");
    setIntakeRule("WITH_FOOD");
    setIdealTimeInput("08:00");
    setClinicalNotes("");
    setStockPending(false);
    setCurrentStock("30");
    setPkgPending(false);
    setUnitsPerPackage("30");
    setPricePending(false);
    setPackagePrice("");
    setPreferredPharmacy("");
    setPurchasePriority("2");
    setSafetyBufferDays("7");
    setFormError(null);
  }

  function openNewMedicationForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditMedicationForm(med: Medication) {
    setEditingMedId(med.id);
    setName(med.name);
    setActiveIngredient(med.active_ingredient ?? "");
    setPresentation(med.presentation);
    setDoseAmount(String(med.dose_amount));
    setFrequencyType(med.frequency_type);
    setFrequencyValue(String(med.frequency_value));
    setToleranceMins(String(med.tolerance_window_mins));
    setIntakeRule(med.intake_rule);
    const times =
      med.schedules && med.schedules.length > 0
        ? med.schedules.map((s) => formatShortTime(s.ideal_time)).join(", ")
        : "08:00";
    setIdealTimeInput(times);
    setClinicalNotes(med.clinical_notes ?? "");

    setStockPending(med.current_stock === null);
    setCurrentStock(med.current_stock !== null ? String(med.current_stock) : "");
    setPkgPending(med.units_per_package === null);
    setUnitsPerPackage(
      med.units_per_package !== null ? String(med.units_per_package) : ""
    );
    setPricePending(med.package_price === null);
    setPackagePrice(
      med.package_price !== null ? String(med.package_price) : ""
    );
    setPreferredPharmacy(med.preferred_pharmacy ?? "");
    setPurchasePriority(String(med.purchase_priority ?? 2));
    setSafetyBufferDays(String(med.safety_buffer_days ?? 7));
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError("Escribe el nombre del medicamento.");
      return;
    }

    const doseNum = Number(doseAmount);
    const freqNum = Number(frequencyValue);
    const tolNum = Number(toleranceMins);
    if (
      !Number.isFinite(doseNum) ||
      doseNum <= 0 ||
      !Number.isFinite(freqNum) ||
      freqNum <= 0
    ) {
      setFormError("Dosis y frecuencia deben ser valores numericos mayores a 0.");
      return;
    }

    let stockVal: number | null = null;
    if (!stockPending && currentStock.trim() !== "") {
      const parsed = Number(currentStock);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFormError("El inventario actual debe ser >= 0 o marcarse como pendiente.");
        return;
      }
      stockVal = parsed;
    }

    let pkgVal: number | null = null;
    if (!pkgPending && unitsPerPackage.trim() !== "") {
      const parsed = Number(unitsPerPackage);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setFormError("Las piezas por envase deben ser > 0 o marcarse como pendiente.");
        return;
      }
      pkgVal = parsed;
    }

    let priceVal: number | null = null;
    if (!pricePending && packagePrice.trim() !== "") {
      const parsed = Number(packagePrice);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFormError("El precio por envase debe ser >= 0 o marcarse como pendiente.");
        return;
      }
      priceVal = parsed;
    }

    const idealTimes = idealTimeInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setIsSubmitting(true);
    try {
      await onSaveMedication({
        id: editingMedId ?? undefined,
        name: name.trim(),
        active_ingredient: activeIngredient.trim() || null,
        presentation: presentation.trim() || "Tableta",
        units_per_package: pkgVal,
        package_price: priceVal,
        dose_amount: doseNum,
        current_stock: stockVal,
        frequency_type: frequencyType,
        frequency_value: Math.round(freqNum),
        tolerance_window_mins: Number.isFinite(tolNum) ? Math.round(tolNum) : 30,
        intake_rule: intakeRule,
        preferred_pharmacy: preferredPharmacy.trim() || null,
        purchase_priority: Number(purchasePriority) || 2,
        safety_buffer_days: Number(safetyBufferDays) || 7,
        clinical_notes: clinicalNotes.trim() || null,
        ideal_times: idealTimes.length > 0 ? idealTimes : ["08:00"],
      });
      resetForm();
      setShowForm(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Error al guardar medicamento."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleQuickRestock(med: Medication) {
    const qty = Number(restockQty);
    if (!Number.isFinite(qty) || qty <= 0) return;

    const expenseAmt =
      restockPrice.trim() !== "" && Number.isFinite(Number(restockPrice))
        ? Number(restockPrice)
        : null;
    const pkgUnitsVal =
      restockPkgUnits.trim() !== "" && Number.isFinite(Number(restockPkgUnits))
        ? Number(restockPkgUnits)
        : null;

    await onRestockMedication(med.id, qty, {
      package_price:
        expenseAmt !== null && med.package_price === null ? expenseAmt : undefined,
      units_per_package: pkgUnitsVal ?? undefined,
      expense_amount: expenseAmt,
      provider_or_pharmacy: restockPharmacy.trim() || null,
      log_expense: restockLogExpense && expenseAmt !== null,
    });
    setRestockId(null);
    setRestockPrice("");
    setRestockPkgUnits("");
    setRestockPharmacy("");
  }

  async function handleAdjustSubmit(med: Medication) {
    const exactVal = adjustMarkPending ? null : Number(adjustStockVal);
    if (!adjustMarkPending && (!Number.isFinite(exactVal) || (exactVal ?? -1) < 0)) {
      return;
    }
    await onAdjustStock(med.id, exactVal, adjustReason.trim() || "Ajuste manual");
    setAdjustId(null);
  }

  async function handleClusterSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clusterLabel.trim() || !clusterTime.trim()) return;
    if (editingClusterId) {
      await onUpdateCluster(editingClusterId, {
        label: clusterLabel.trim(),
        anchor_time: clusterTime.trim(),
        intake_rule: clusterRule,
        is_active: true,
      });
    } else {
      await onCreateCluster({
        label: clusterLabel.trim(),
        anchor_time: clusterTime.trim(),
        intake_rule: clusterRule,
      });
    }
    setEditingClusterId(null);
    setClusterLabel("");
    setClusterTime("08:00");
    setClusterRule("WITH_FOOD");
  }

  function startEditCluster(cl: IntakeCluster) {
    setEditingClusterId(cl.id);
    setClusterLabel(cl.label);
    setClusterTime(formatShortTime(cl.anchor_time));
    setClusterRule(cl.intake_rule);
  }

  const baseList =
    filterTab === "archived"
      ? snapshot.archived_medications
      : filterTab === "incomplete"
      ? snapshot.incomplete_medications
      : filterTab === "critical"
      ? snapshot.low_stock_medications
      : snapshot.medications;

  const q = searchQuery.trim().toLowerCase();
  const visibleMeds = q
    ? baseList.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.active_ingredient ?? "").toLowerCase().includes(q) ||
          (m.clinical_notes ?? "").toLowerCase().includes(q)
      )
    : baseList;

  return (
    <div className="space-y-6 clinical-enter">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-[#0F172A]">
            Inventario Farmacologico y Gobernanza de Tratamiento
          </h2>
          <p className="text-[14px] text-[#475569]">
            Normas diferenciadas: nucleo clinico obligatorio y datos comerciales
            (precio, envase, stock inicial) completables despues.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowClusterManager((v) => !v)}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            <SlidersHorizontal
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Bloques Horarios ({snapshot.clusters.length})
          </button>

          <button
            type="button"
            onClick={() => onGenerateTodayLogs()}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            <RefreshCw
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Regenerar Tomas de Hoy
          </button>

          <button
            type="button"
            onClick={() => {
              if (showForm && !editingMedId) {
                setShowForm(false);
              } else {
                openNewMedicationForm();
              }
            }}
            className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            {showForm ? "Cerrar Formulario" : "Registrar Medicamento"}
          </button>
        </div>
      </div>

      {/* Gestor de Bloques Horarios (Clusters CRUD) */}
      {showClusterManager && (
        <section className="clinical-card p-5 space-y-4 border-[#A5F3FC]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2.5">
            <h3 className="text-[16px] font-bold text-[#0F172A]">
              Gobernanza de Bloques Horarios (Clusters)
            </h3>
            <span className="text-[13px] text-[#475569]">
              Editar una hora ancla actualiza automaticamente los horarios vinculados.
            </span>
          </div>

          <form
            onSubmit={handleClusterSubmit}
            className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end bg-[#F8FAFC] p-3.5 rounded-[6px] border border-[#E2E8F0]"
          >
            <div>
              <label
                htmlFor="cl-label"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Nombre del bloque
              </label>
              <input
                id="cl-label"
                type="text"
                required
                placeholder="Ej. Bloque Desayuno"
                value={clusterLabel}
                onChange={(e) => setClusterLabel(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="cl-time"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Hora ancla (HH:MM)
              </label>
              <input
                id="cl-time"
                type="time"
                required
                value={clusterTime}
                onChange={(e) => setClusterTime(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="cl-rule"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Regla clinica del bloque
              </label>
              <select
                id="cl-rule"
                value={clusterRule}
                onChange={(e) =>
                  setClusterRule(e.target.value as IntakeConstraint)
                }
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
              >
                <option value="WITH_FOOD">Con Alimentos</option>
                <option value="FASTING">En Ayunas</option>
                <option value="NONE">Sin Restriccion</option>
                <option value="SEPARATE_FROM_OTHERS">Separado de Otros</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="clinical-btn flex-1 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
              >
                {editingClusterId ? "Actualizar Bloque" : "Agregar Bloque"}
              </button>
              {editingClusterId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingClusterId(null);
                    setClusterLabel("");
                    setClusterTime("08:00");
                  }}
                  className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[13px]"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {snapshot.clusters.map((cl) => (
              <div
                key={cl.id}
                className="border border-[#E2E8F0] rounded-[6px] p-3 flex items-center justify-between gap-2 bg-white"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Clock
                      className="w-4 h-4 text-[#0E7490]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span className="font-mono font-bold text-[15px] text-[#0F172A]">
                      {formatShortTime(cl.anchor_time)}
                    </span>
                    <span className="font-bold text-[14px] text-[#0F172A]">
                      {cl.label}
                    </span>
                  </div>
                  <div className="mt-1">
                    <StatusBadge
                      label={INTAKE_RULE_TAG[cl.intake_rule]}
                      tone="info"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => startEditCluster(cl)}
                    className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px]"
                  >
                    Editar
                  </button>
                  {confirmDeleteClusterId === cl.id ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeleteCluster(cl.id);
                          setConfirmDeleteClusterId(null);
                        }}
                        className="clinical-btn px-2.5 bg-[#991B1B] text-white text-[13px] font-bold"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteClusterId(null)}
                        className="clinical-btn px-2 border border-[#CBD5E1] bg-white text-[13px]"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteClusterId(cl.id)}
                      className="clinical-btn px-2.5 border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#991B1B] text-[13px]"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Formulario Crear / Editar con Normas Obligatorias vs Diferibles */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="clinical-card p-5 space-y-5 border-[#A5F3FC] bg-white"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
            <div>
              <h3 className="text-[16px] font-bold text-[#0F172A]">
                {editingMedId
                  ? `Editar Medicamento: ${name}`
                  : "Nuevo Medicamento — Normas de Registro"}
              </h3>
              <p className="text-[13px] text-[#475569]">
                Obligatorio: posologia y horario clinico. Opcional/Diferible:
                inventario, piezas por caja y precio (puede marcarse pendiente).
              </p>
            </div>
            <span className="font-mono text-[13px] px-2.5 py-1 bg-[#ECFEFF] border border-[#A5F3FC] text-[#164E63] rounded-[4px] tabular-nums">
              Tasa diaria: {computedRate} unid/dia
            </span>
          </div>

          {/* Seccion 1: Nucleo Clinico Obligatorio */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusBadge label="[1. OBLIGATORIO]" tone="info" />
              <span className="text-[14px] font-bold text-[#0F172A]">
                Nucleo Clinico y Posologia
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="med-name"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Nombre comercial / concentracion *
                </label>
                <input
                  id="med-name"
                  type="text"
                  required
                  placeholder="Ej. Rolet Sup 80/12.5"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
                />
              </div>

              <div>
                <label
                  htmlFor="med-ingredient"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Principio activo (opcional)
                </label>
                <input
                  id="med-ingredient"
                  type="text"
                  placeholder="Ej. Telmisartan / Hidroclorotiazida"
                  value={activeIngredient}
                  onChange={(e) => setActiveIngredient(e.target.value)}
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
                />
              </div>

              <div>
                <label
                  htmlFor="med-presentation"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Presentacion *
                </label>
                <select
                  id="med-presentation"
                  value={presentation}
                  onChange={(e) => setPresentation(e.target.value)}
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
                >
                  <option value="Tableta">Tableta</option>
                  <option value="Capsula">Capsula</option>
                  <option value="Inyeccion">Inyeccion</option>
                  <option value="Jeringa Prellenada">Jeringa Prellenada</option>
                  <option value="Ampolleta">Ampolleta</option>
                  <option value="ml">ml</option>
                  <option value="Gotas">Gotas</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="med-dose"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Cantidad por toma *
                </label>
                <input
                  id="med-dose"
                  type="number"
                  step="0.5"
                  min="0.1"
                  required
                  value={doseAmount}
                  onChange={(e) => setDoseAmount(e.target.value)}
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="med-freq-type"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Tipo de periodicidad *
                </label>
                <select
                  id="med-freq-type"
                  value={frequencyType}
                  onChange={(e) =>
                    setFrequencyType(e.target.value as MedFrequencyType)
                  }
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
                >
                  <option value="DAILY_SLOTS">Tomas por dia (ej. 1, 2)</option>
                  <option value="FIXED_HOURS">Cada N horas (ej. 8h, 12h)</option>
                  <option value="INTERVAL_DAYS">Cada N dias</option>
                  <option value="INTERVAL_WEEKS">Cada N semanas</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="med-freq-val"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Valor de frecuencia *
                </label>
                <input
                  id="med-freq-val"
                  type="number"
                  min="1"
                  required
                  value={frequencyValue}
                  onChange={(e) => setFrequencyValue(e.target.value)}
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="med-rule"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Regla de ingesta *
                </label>
                <select
                  id="med-rule"
                  value={intakeRule}
                  onChange={(e) =>
                    setIntakeRule(e.target.value as IntakeConstraint)
                  }
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
                >
                  <option value="WITH_FOOD">Con Alimentos</option>
                  <option value="NONE">Sin Restriccion</option>
                  <option value="FASTING">En Ayunas</option>
                  <option value="SEPARATE_FROM_OTHERS">Separado de Otros</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="med-ideal-times"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Horarios ideales (HH:MM, separados por coma)
                </label>
                <input
                  id="med-ideal-times"
                  type="text"
                  placeholder="08:00 o 08:00, 21:00"
                  value={idealTimeInput}
                  onChange={(e) => setIdealTimeInput(e.target.value)}
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="med-tolerance"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Ventana de tolerancia (mins)
                </label>
                <input
                  id="med-tolerance"
                  type="number"
                  min="0"
                  max="180"
                  value={toleranceMins}
                  onChange={(e) => setToleranceMins(e.target.value)}
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Seccion 2: Inventario, Costos y Abasto (Diferible / Opcional) */}
          <div className="space-y-3 pt-3 border-t border-[#E2E8F0]">
            <div className="flex items-center gap-2">
              <StatusBadge label="[2. OPCIONAL / DIFERIBLE]" tone="warn" />
              <span className="text-[14px] font-bold text-[#0F172A]">
                Inventario, Precio de Envase y Planificacion Quincenal
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-[#F8FAFC] p-4 rounded-[6px] border border-[#E2E8F0]">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="med-stock"
                    className="text-[14px] font-medium text-[#0F172A]"
                  >
                    Inventario actual
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-[#92400E] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stockPending}
                      onChange={(e) => setStockPending(e.target.checked)}
                      className="accent-[#0E7490]"
                    />
                    Pendiente
                  </label>
                </div>
                <input
                  id="med-stock"
                  type="number"
                  step="0.5"
                  min="0"
                  disabled={stockPending}
                  placeholder={stockPending ? "Pendiente de compra" : "Ej. 30"}
                  value={stockPending ? "" : currentStock}
                  onChange={(e) => setCurrentStock(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums bg-white disabled:bg-[#F1F5F9]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="med-pkg-units"
                    className="text-[14px] font-medium text-[#0F172A]"
                  >
                    Unidades por envase / caja
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-[#92400E] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pkgPending}
                      onChange={(e) => setPkgPending(e.target.checked)}
                      className="accent-[#0E7490]"
                    />
                    Pendiente
                  </label>
                </div>
                <input
                  id="med-pkg-units"
                  type="number"
                  step="1"
                  min="1"
                  disabled={pkgPending}
                  placeholder={pkgPending ? "Pendiente" : "Ej. 30"}
                  value={pkgPending ? "" : unitsPerPackage}
                  onChange={(e) => setUnitsPerPackage(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums bg-white disabled:bg-[#F1F5F9]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="med-price"
                    className="text-[14px] font-medium text-[#0F172A]"
                  >
                    Precio por envase (MXN)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-[#92400E] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pricePending}
                      onChange={(e) => setPricePending(e.target.checked)}
                      className="accent-[#0E7490]"
                    />
                    Pendiente
                  </label>
                </div>
                <input
                  id="med-price"
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={pricePending}
                  placeholder={pricePending ? "Pendiente" : "Ej. 250.00"}
                  value={pricePending ? "" : packagePrice}
                  onChange={(e) => setPackagePrice(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums bg-white disabled:bg-[#F1F5F9]"
                />
              </div>

              <div>
                <label
                  htmlFor="med-pharmacy"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Farmacia habitual (opcional)
                </label>
                <input
                  id="med-pharmacy"
                  type="text"
                  placeholder="Ej. Farmacia Guadalajara / Similar"
                  value={preferredPharmacy}
                  onChange={(e) => setPreferredPharmacy(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px] bg-white"
                />
              </div>

              <div>
                <label
                  htmlFor="med-prio"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Prioridad de compra
                </label>
                <select
                  id="med-prio"
                  value={purchasePriority}
                  onChange={(e) => setPurchasePriority(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px] bg-white"
                >
                  <option value="1">1 - Esencial / Critico</option>
                  <option value="2">2 - Prioridad Media</option>
                  <option value="3">3 - Suplemento / Flexible</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="med-buffer"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Colchon de seguridad (dias)
                </label>
                <input
                  id="med-buffer"
                  type="number"
                  min="1"
                  max="60"
                  value={safetyBufferDays}
                  onChange={(e) => setSafetyBufferDays(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] bg-white"
                />
              </div>

              <div className="md:col-span-3">
                <label
                  htmlFor="med-notes"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Notas clinicas de administracion
                </label>
                <input
                  id="med-notes"
                  type="text"
                  placeholder="Indicaciones medicas o notas sobre adquisicion"
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
                />
              </div>
            </div>
          </div>

          {formError && (
            <p className="text-[14px] font-medium text-[#991B1B]" role="alert">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px] font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[15px] font-bold"
            >
              {isSubmitting
                ? "Guardando y optimizando..."
                : editingMedId
                ? "Guardar Cambios"
                : "Guardar y Optimizar Bloques"}
            </button>
          </div>
        </form>
      )}

      {/* Filtros y Buscador */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["active", `Activos (${snapshot.medications.length})`],
              [
                "incomplete",
                `Datos Pendientes (${snapshot.incomplete_medications.length})`,
              ],
              [
                "critical",
                `Criticos <=7d (${snapshot.low_stock_medications.length})`,
              ],
              [
                "archived",
                `Archivados (${snapshot.archived_medications.length})`,
              ],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilterTab(id)}
              className={cn(
                "clinical-btn px-3.5 text-[13px] font-semibold border",
                filterTab === id
                  ? "bg-[#0F172A] border-[#0F172A] text-white"
                  : "bg-white border-[#CBD5E1] text-[#334155] hover:bg-[#F8FAFC]"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Buscar por nombre o principio activo..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px] w-full sm:w-[280px]"
        />
      </div>

      {/* Tabla de Inventario y Gobernanza */}
      <div className="clinical-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[13px] font-semibold text-[#475569]">
                <th className="py-3 px-4">Farmaco / Principio</th>
                <th className="py-3 px-3">Dosis / Periodicidad</th>
                <th className="py-3 px-3">Regla y Bloques</th>
                <th className="py-3 px-3">Costo y Envase</th>
                <th className="py-3 px-3">Stock y Cobertura</th>
                <th className="py-3 px-4 text-right">Gobernanza</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {visibleMeds.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 px-4 text-center text-[14px] text-[#64748B]"
                  >
                    No hay medicamentos en esta vista.
                  </td>
                </tr>
              ) : (
                visibleMeds.map((med) => {
                  const days =
                    med.days_of_supply_remaining !== null
                      ? Number(med.days_of_supply_remaining)
                      : null;
                  const level =
                    days === null
                      ? "warn"
                      : days <= 7
                      ? "crit"
                      : days <= 14
                      ? "warn"
                      : "ok";
                  const progressPct =
                    days === null
                      ? 0
                      : Math.min(100, Math.max(4, (days / 30) * 100));
                  const hasIncompleteData =
                    med.current_stock === null ||
                    med.package_price === null ||
                    med.units_per_package === null;

                  const monthlyCostEst =
                    med.package_price !== null &&
                    med.units_per_package &&
                    med.units_per_package > 0
                      ? ((med.daily_consumption_rate * 30) /
                          med.units_per_package) *
                        med.package_price
                      : null;

                  return (
                    <tr key={med.id} className="bg-white hover:bg-[#F8FAFC]">
                      <td className="py-3.5 px-4 align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-[15px] text-[#0F172A]">
                            {med.name}
                          </span>
                          {hasIncompleteData && (
                            <StatusBadge label="[DATOS PENDIENTES]" tone="warn" />
                          )}
                          {!med.is_active && (
                            <StatusBadge label="[ARCHIVADO]" tone="neutral" />
                          )}
                        </div>
                        {med.active_ingredient && (
                          <div className="text-[13px] text-[#475569]">
                            {med.active_ingredient}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          <StatusBadge
                            label={
                              PURCHASE_PRIORITY_TAG[med.purchase_priority] ??
                              "[MEDIA]"
                            }
                            tone={med.purchase_priority === 1 ? "info" : "neutral"}
                          />
                        </div>
                        {med.clinical_notes && (
                          <p className="mt-1.5 text-[13px] text-[#64748B] max-w-[32ch]">
                            {med.clinical_notes}
                          </p>
                        )}
                        {!med.is_active && med.discontinuation_reason && (
                          <p className="mt-1 text-[13px] text-[#991B1B]">
                            Motivo archivo: {med.discontinuation_reason}
                          </p>
                        )}
                      </td>

                      <td className="py-3.5 px-3 align-top">
                        <div className="font-mono text-[14px] font-semibold tabular-nums text-[#0F172A]">
                          {med.dose_amount} {med.presentation}
                        </div>
                        <div className="text-[13px] text-[#475569] mt-0.5">
                          {FREQUENCY_TYPE_LABEL[med.frequency_type]}:{" "}
                          <span className="font-mono tabular-nums">
                            {med.frequency_value}
                          </span>
                        </div>
                        <div className="font-mono text-[13px] text-[#64748B] tabular-nums">
                          Tasa: {med.daily_consumption_rate}/dia
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-top">
                        <div className="mb-1.5">
                          <StatusBadge
                            label={INTAKE_RULE_TAG[med.intake_rule]}
                            tone="info"
                          />
                          <span className="sr-only">
                            {INTAKE_RULE_LABEL[med.intake_rule]}
                          </span>
                        </div>
                        {med.schedules && med.schedules.length > 0 ? (
                          <ul className="space-y-1">
                            {med.schedules.map((sch) => (
                              <li
                                key={sch.schedule_id}
                                className="font-mono text-[13px] text-[#334155] tabular-nums"
                              >
                                {formatShortTime(sch.ideal_time)} -&gt;{" "}
                                <strong className="text-[#0E7490]">
                                  {formatShortTime(sch.effective_clustered_time)}
                                </strong>{" "}
                                {sch.cluster_label
                                  ? `(${sch.cluster_label})`
                                  : "(Dedicado)"}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-[13px] text-[#64748B]">
                            Vinculado a evento clinico
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-3 align-top font-mono text-[13px] tabular-nums">
                        {med.package_price !== null ? (
                          <div className="font-bold text-[#0F172A]">
                            {formatCurrencyMxn(med.package_price)} /{" "}
                            {med.units_per_package ?? "?"} u.
                          </div>
                        ) : (
                          <StatusBadge label="[PRECIO PENDIENTE]" tone="warn" />
                        )}
                        {monthlyCostEst !== null && (
                          <div className="mt-1 text-[#475569]">
                            Est. 30d: {formatCurrencyMxn(monthlyCostEst)}
                          </div>
                        )}
                        {med.preferred_pharmacy && (
                          <div className="mt-0.5 text-[12px] text-[#64748B] font-sans">
                            {med.preferred_pharmacy}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-3 align-top min-w-[175px]">
                        {med.current_stock === null || days === null ? (
                          <div className="space-y-1">
                            <StatusBadge label="[STOCK PENDIENTE]" tone="warn" />
                            <p className="text-[12px] text-[#64748B]">
                              Captura stock al recibir la caja.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="font-mono text-[14px] font-bold text-[#0F172A] tabular-nums mb-1">
                              {med.current_stock} {med.presentation}
                            </div>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span
                                className={cn(
                                  "font-mono text-[14px] font-bold tabular-nums",
                                  level === "crit"
                                    ? "text-[#991B1B]"
                                    : level === "warn"
                                    ? "text-[#92400E]"
                                    : "text-[#065F46]"
                                )}
                              >
                                {days >= 999 ? "Indef." : `${days} dias`}
                              </span>
                              <StatusBadge
                                label={
                                  level === "crit"
                                    ? "[CRITICO]"
                                    : level === "warn"
                                    ? "[ATENCION]"
                                    : "[OPTIMO]"
                                }
                                tone={level}
                              />
                            </div>
                            <div className="h-2 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-full",
                                  level === "crit"
                                    ? "bg-[#DC2626]"
                                    : level === "warn"
                                    ? "bg-[#D97706]"
                                    : "bg-[#059669]"
                                )}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </>
                        )}
                      </td>

                      <td className="py-3.5 px-4 align-top text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {med.is_active && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRestockId(
                                      restockId === med.id ? null : med.id
                                    );
                                    setAdjustId(null);
                                    setArchiveTargetId(null);
                                    setRestockQty(
                                      String(med.units_per_package ?? 30)
                                    );
                                    setRestockPrice(
                                      med.package_price !== null
                                        ? String(med.package_price)
                                        : ""
                                    );
                                    setRestockPkgUnits(
                                      med.units_per_package !== null
                                        ? String(med.units_per_package)
                                        : ""
                                    );
                                    setRestockPharmacy(
                                      med.preferred_pharmacy ?? ""
                                    );
                                  }}
                                  className="clinical-btn inline-flex items-center gap-1 px-2.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px] font-medium"
                                >
                                  <PackagePlus
                                    className="w-3.5 h-3.5 text-[#0E7490]"
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                  />
                                  Sumar
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setAdjustId(
                                      adjustId === med.id ? null : med.id
                                    );
                                    setRestockId(null);
                                    setArchiveTargetId(null);
                                    setAdjustMarkPending(
                                      med.current_stock === null
                                    );
                                    setAdjustStockVal(
                                      String(med.current_stock ?? 0)
                                    );
                                  }}
                                  className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px]"
                                >
                                  Ajustar
                                </button>
                              </>
                            )}

                            <button
                              type="button"
                              onClick={() => openEditMedicationForm(med)}
                              className={cn(
                                "clinical-btn inline-flex items-center gap-1 px-2.5 border text-[13px] font-medium",
                                hasIncompleteData
                                  ? "bg-[#FEF3C7] border-[#F59E0B] text-[#92400E]"
                                  : "bg-white border-[#CBD5E1] hover:bg-[#F1F5F9] text-[#0F172A]"
                              )}
                            >
                              <Edit3
                                className="w-3.5 h-3.5"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              {hasIncompleteData ? "Completar" : "Editar"}
                            </button>

                            {med.is_active ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setArchiveTargetId(
                                    archiveTargetId === med.id ? null : med.id
                                  );
                                  setRestockId(null);
                                  setAdjustId(null);
                                }}
                                className="clinical-btn inline-flex items-center gap-1 px-2.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#475569] text-[13px]"
                                title="Suspender o archivar tratamiento"
                              >
                                <Archive
                                  className="w-3.5 h-3.5"
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                />
                                Archivar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onRestoreMedication(med.id)}
                                className="clinical-btn inline-flex items-center gap-1 px-2.5 border border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46] text-[13px] font-medium"
                              >
                                <RotateCcw
                                  className="w-3.5 h-3.5"
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                />
                                Restaurar
                              </button>
                            )}

                            {confirmDeleteMedId === med.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onDeleteMedication(med.id);
                                    setConfirmDeleteMedId(null);
                                  }}
                                  className="clinical-btn px-2.5 bg-[#991B1B] text-white text-[13px] font-bold"
                                >
                                  Confirmar Borrar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteMedId(null)}
                                  className="clinical-btn px-2 border border-[#CBD5E1] bg-white text-[13px]"
                                >
                                  No
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteMedId(med.id)}
                                className="clinical-btn px-2 border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#991B1B]"
                                aria-label={`Eliminar ${med.name}`}
                              >
                                <Trash2
                                  className="w-3.5 h-3.5"
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                />
                              </button>
                            )}
                          </div>

                          {/* Panel inline de Restock + Registro de Gasto */}
                          {restockId === med.id && (
                            <div className="mt-2 p-3 border border-[#A5F3FC] bg-[#F8FAFC] rounded-[6px] text-left space-y-2 w-full max-w-[300px]">
                              <div className="text-[12px] font-bold text-[#0F172A]">
                                Sumar Stock y Registrar Compra
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] text-[#475569]">
                                    Unidades +{med.presentation}
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={restockQty}
                                    onChange={(e) =>
                                      setRestockQty(e.target.value)
                                    }
                                    className="w-full h-[38px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[13px]"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] text-[#475569]">
                                    Costo pagado MXN
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Opcional"
                                    value={restockPrice}
                                    onChange={(e) =>
                                      setRestockPrice(e.target.value)
                                    }
                                    className="w-full h-[38px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[13px]"
                                  />
                                </div>
                              </div>
                              {med.units_per_package === null && (
                                <div>
                                  <label className="block text-[11px] text-[#475569]">
                                    Piezas por envase (para catalogo)
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    placeholder="Ej. 30"
                                    value={restockPkgUnits}
                                    onChange={(e) =>
                                      setRestockPkgUnits(e.target.value)
                                    }
                                    className="w-full h-[38px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[13px]"
                                  />
                                </div>
                              )}
                              <input
                                type="text"
                                placeholder="Farmacia (opcional)"
                                value={restockPharmacy}
                                onChange={(e) =>
                                  setRestockPharmacy(e.target.value)
                                }
                                className="w-full h-[36px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white text-[13px]"
                              />
                              <label className="inline-flex items-center gap-1.5 text-[12px] text-[#334155]">
                                <input
                                  type="checkbox"
                                  checked={restockLogExpense}
                                  onChange={(e) =>
                                    setRestockLogExpense(e.target.checked)
                                  }
                                  className="accent-[#0E7490]"
                                />
                                Guardar en Bitacora de Gastos
                              </label>
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setRestockId(null)}
                                  className="px-2.5 h-[36px] border border-[#CBD5E1] bg-white rounded-[6px] text-[12px]"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleQuickRestock(med)}
                                  className="px-3 h-[36px] bg-[#0E7490] text-white rounded-[6px] text-[12px] font-bold"
                                >
                                  Confirmar
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Panel inline de Ajuste Exacto de Stock */}
                          {adjustId === med.id && (
                            <div className="mt-2 p-3 border border-[#CBD5E1] bg-[#F8FAFC] rounded-[6px] text-left space-y-2 w-full max-w-[280px]">
                              <div className="text-[12px] font-bold text-[#0F172A]">
                                Ajuste Exacto (Conteo Fisico)
                              </div>
                              <label className="inline-flex items-center gap-1.5 text-[12px] text-[#92400E]">
                                <input
                                  type="checkbox"
                                  checked={adjustMarkPending}
                                  onChange={(e) =>
                                    setAdjustMarkPending(e.target.checked)
                                  }
                                  className="accent-[#0E7490]"
                                />
                                Marcar stock como pendiente (NULL)
                              </label>
                              {!adjustMarkPending && (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={adjustStockVal}
                                  onChange={(e) =>
                                    setAdjustStockVal(e.target.value)
                                  }
                                  className="w-full h-[38px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[13px]"
                                />
                              )}
                              <input
                                type="text"
                                placeholder="Motivo del ajuste"
                                value={adjustReason}
                                onChange={(e) => setAdjustReason(e.target.value)}
                                className="w-full h-[36px] px-2 border border-[#CBD5E1] rounded-[6px] bg-white text-[13px]"
                              />
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setAdjustId(null)}
                                  className="px-2.5 h-[36px] border border-[#CBD5E1] bg-white rounded-[6px] text-[12px]"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdjustSubmit(med)}
                                  className="px-3 h-[36px] bg-[#0F172A] text-white rounded-[6px] text-[12px] font-bold"
                                >
                                  Fijar Stock
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Panel inline de Archivado */}
                          {archiveTargetId === med.id && (
                            <div className="mt-2 p-3 border border-[#FECACA] bg-[#FEF2F2] rounded-[6px] text-left space-y-2 w-full max-w-[280px]">
                              <div className="text-[12px] font-bold text-[#991B1B]">
                                Suspender / Archivar Farmaco
                              </div>
                              <input
                                type="text"
                                placeholder="Motivo medico (ej. Fin de esquema)"
                                value={archiveReason}
                                onChange={(e) =>
                                  setArchiveReason(e.target.value)
                                }
                                className="w-full h-[36px] px-2 border border-[#FECACA] rounded-[6px] bg-white text-[13px]"
                              />
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setArchiveTargetId(null)}
                                  className="px-2.5 h-[36px] border border-[#CBD5E1] bg-white rounded-[6px] text-[12px]"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onArchiveMedication(
                                      med.id,
                                      archiveReason.trim() || null
                                    );
                                    setArchiveTargetId(null);
                                    setArchiveReason("");
                                  }}
                                  className="px-3 h-[36px] bg-[#991B1B] text-white rounded-[6px] text-[12px] font-bold"
                                >
                                  Confirmar Archivo
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
