"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Archive,
  CalendarClock,
  Check,
  Clock,
  Edit3,
  History,
  Info,
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
import {
  activeDaysEqual,
  calculateEffectiveDailyRate,
  DAY_SCHEDULE_PRESETS,
  formatActiveDaysLabel,
  normalizeActiveDays,
  WEEKDAY_LABEL,
  WEEKDAY_ORDER,
  WEEKDAY_TWO_CHAR,
} from "@/lib/periodicity";
import {
  cn,
  formatCurrencyMxn,
  formatShortTime,
  getLocalDateIso,
} from "@/lib/utils";
import { ClinicalModal } from "./ClinicalModal";
import { IconActionButton } from "./IconActionButton";
import { MedicationVersionsModal } from "./MedicationVersionsModal";
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
  active_days: number[] | null;
  schedule_start_date: string | null;
  event_linked_only: boolean;
  preferred_pharmacy: string | null;
  purchase_priority: number;
  safety_buffer_days: number;
  clinical_notes: string | null;
  ideal_times: string[];
}

interface MedicationsInventoryViewProps {
  snapshot: CommandCenterSnapshot;
  isAdmin: boolean;
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
  onRestoreVersion: (medicationId: string, versionId: string) => Promise<void>;
  onMarkVersionReviewed: (versionId: string) => Promise<void>;
  onGenerateTodayLogs: (overrideDate?: string) => Promise<void>;
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

const DEFAULT_SLOT_DEFAULTS = ["08:00", "15:00", "21:00", "23:00", "06:00", "12:00"];

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function buildInitialSlots(count: number, clusterAnchors: string[]): string[] {
  const safeCount = Math.max(1, Math.min(8, count));
  const pool =
    clusterAnchors.length > 0 ? clusterAnchors : DEFAULT_SLOT_DEFAULTS;
  const result: string[] = [];
  for (let i = 0; i < safeCount; i++) {
    result.push(pool[i] ?? DEFAULT_SLOT_DEFAULTS[i] ?? "08:00");
  }
  return result;
}

export function MedicationsInventoryView({
  snapshot,
  isAdmin,
  onSaveMedication,
  onRestockMedication,
  onAdjustStock,
  onArchiveMedication,
  onRestoreMedication,
  onDeleteMedication,
  onRestoreVersion,
  onMarkVersionReviewed,
  onGenerateTodayLogs,
  onCreateCluster,
  onUpdateCluster,
  onDeleteCluster,
}: MedicationsInventoryViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // Modal Create/Edit Medication
  const [medModalOpen, setMedModalOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [medName, setMedName] = useState("");
  const [medIngredient, setMedIngredient] = useState("");
  const [medPresentation, setMedPresentation] = useState("Tabletas");
  const [medDose, setMedDose] = useState("1");
  const [medFreqType, setMedFreqType] = useState<MedFrequencyType>("DAILY_SLOTS");
  const [medFreqVal, setMedFreqVal] = useState("1");
  const [medTolerance, setMedTolerance] = useState("45");
  const [medRule, setMedRule] = useState<IntakeConstraint>("WITH_FOOD");
  const [medActiveDays, setMedActiveDays] = useState<number[] | null>(null);
  const [medScheduleStart, setMedScheduleStart] = useState<string>(
    getLocalDateIso()
  );
  const [medEventLinkedOnly, setMedEventLinkedOnly] = useState(false);
  const [medSlotTimes, setMedSlotTimes] = useState<string[]>(["08:00"]);
  const [medStartTime, setMedStartTime] = useState("08:00");
  const [medStock, setMedStock] = useState("");
  const [medUnitsPkg, setMedUnitsPkg] = useState("");
  const [medPrice, setMedPrice] = useState("");
  const [medPharmacy, setMedPharmacy] = useState("");
  const [medPriority, setMedPriority] = useState("2");
  const [medBufferDays, setMedBufferDays] = useState("7");
  const [medNotes, setMedNotes] = useState("");
  const [medFormError, setMedFormError] = useState<string | null>(null);
  const [savingMed, setSavingMed] = useState(false);

  // Modal Restock
  const [restockTarget, setRestockTarget] = useState<Medication | null>(null);
  const [restockQty, setRestockQty] = useState("30");
  const [restockUnitsPkg, setRestockUnitsPkg] = useState("");
  const [restockPkgPrice, setRestockPkgPrice] = useState("");
  const [restockExpenseAmount, setRestockExpenseAmount] = useState("");
  const [restockPharmacy, setRestockPharmacy] = useState("");
  const [restockPaymentMethod, setRestockPaymentMethod] = useState("Tarjeta");
  const [restockLogExpense, setRestockLogExpense] = useState(true);
  const [restockError, setRestockError] = useState<string | null>(null);
  const [savingRestock, setSavingRestock] = useState(false);

  // Modal Adjust Stock
  const [adjustTarget, setAdjustTarget] = useState<Medication | null>(null);
  const [adjustStockVal, setAdjustStockVal] = useState("");
  const [adjustUnknown, setAdjustUnknown] = useState(false);
  const [adjustReason, setAdjustReason] = useState("Conteo fisico manual");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [savingAdjust, setSavingAdjust] = useState(false);

  // Modal Archive (Admin)
  const [archiveTarget, setArchiveTarget] = useState<Medication | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [savingArchive, setSavingArchive] = useState(false);

  // Modal Versions (Admin)
  const [versionsTarget, setVersionsTarget] = useState<Medication | null>(null);

  // Modal Clusters
  const [clustersModalOpen, setClustersModalOpen] = useState(false);
  const [editingCluster, setEditingCluster] = useState<IntakeCluster | null>(null);
  const [clusterLabel, setClusterLabel] = useState("");
  const [clusterAnchor, setClusterAnchor] = useState("15:00");
  const [clusterRule, setClusterRule] = useState<IntakeConstraint>("WITH_FOOD");
  const [clusterActive, setClusterActive] = useState(true);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [savingCluster, setSavingCluster] = useState(false);
  const [confirmDeleteClusterId, setConfirmDeleteClusterId] = useState<
    string | null
  >(null);

  // Busy & 2-step delete state
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDeleteMedId, setConfirmDeleteMedId] = useState<string | null>(
    null
  );

  const clusterAnchors = useMemo(
    () =>
      snapshot.clusters
        .filter((c) => c.is_active)
        .map((c) => formatShortTime(c.anchor_time)),
    [snapshot.clusters]
  );

  const filteredMeds = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return snapshot.medications;
    return snapshot.medications.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.active_ingredient ?? "").toLowerCase().includes(q) ||
        (m.preferred_pharmacy ?? "").toLowerCase().includes(q)
    );
  }, [snapshot.medications, searchTerm]);

  const versionsByMedId = useMemo(() => {
    const map = new Map<
      string,
      { total: number; unreviewed: number }
    >();
    if (!isAdmin) return map;
    for (const ver of snapshot.medication_versions) {
      const current = map.get(ver.medication_id) ?? {
        total: 0,
        unreviewed: 0,
      };
      current.total += 1;
      if (ver.changed_by_role === "PATIENT" && !ver.reviewed_by_admin) {
        current.unreviewed += 1;
      }
      map.set(ver.medication_id, current);
    }
    return map;
  }, [isAdmin, snapshot.medication_versions]);

  // Preview rate in Create/Edit modal
  const previewRate = useMemo(() => {
    const doseNum = parseOptionalNumber(medDose) ?? 1;
    const freqNum = Math.max(1, Number.parseInt(medFreqVal || "1", 10) || 1);
    const daysArg =
      medFreqType === "DAILY_SLOTS" || medFreqType === "FIXED_HOURS"
        ? medActiveDays
        : null;
    return calculateEffectiveDailyRate(doseNum, medFreqType, freqNum, daysArg);
  }, [medDose, medFreqType, medFreqVal, medActiveDays]);

  const previewSupplyDays = useMemo(() => {
    const stockNum = parseOptionalNumber(medStock);
    if (stockNum === null || previewRate <= 0) return null;
    return Number((stockNum / previewRate).toFixed(1));
  }, [medStock, previewRate]);

  function openCreateMedicationModal() {
    setEditingMed(null);
    setMedName("");
    setMedIngredient("");
    setMedPresentation("Tabletas");
    setMedDose("1");
    setMedFreqType("DAILY_SLOTS");
    setMedFreqVal("1");
    setMedTolerance("45");
    setMedRule("WITH_FOOD");
    setMedActiveDays(null);
    setMedScheduleStart(getLocalDateIso());
    setMedEventLinkedOnly(false);
    setMedSlotTimes([clusterAnchors[0] ?? "08:00"]);
    setMedStartTime(clusterAnchors[0] ?? "08:00");
    setMedStock("");
    setMedUnitsPkg("");
    setMedPrice("");
    setMedPharmacy("");
    setMedPriority("2");
    setMedBufferDays("7");
    setMedNotes("");
    setMedFormError(null);
    setMedModalOpen(true);
  }

  function openEditMedicationModal(med: Medication) {
    setEditingMed(med);
    setMedName(med.name);
    setMedIngredient(med.active_ingredient ?? "");
    setMedPresentation(med.presentation);
    setMedDose(String(med.dose_amount));
    setMedFreqType(med.frequency_type);
    setMedFreqVal(String(med.frequency_value));
    setMedTolerance(String(med.tolerance_window_mins));
    setMedRule(med.intake_rule);
    setMedActiveDays(normalizeActiveDays(med.active_days));
    setMedScheduleStart(
      med.schedule_start_date
        ? med.schedule_start_date.slice(0, 10)
        : getLocalDateIso()
    );

    const existingTimes = (med.schedules ?? []).map((s) =>
      formatShortTime(s.ideal_time)
    );
    const isIntervalMed =
      med.frequency_type === "INTERVAL_DAYS" ||
      med.frequency_type === "INTERVAL_WEEKS";
    setMedEventLinkedOnly(isIntervalMed && existingTimes.length === 0);

    if (med.frequency_type === "DAILY_SLOTS") {
      const targetCount = Math.max(1, med.frequency_value);
      const defaults = buildInitialSlots(targetCount, clusterAnchors);
      const merged = Array.from(
        { length: targetCount },
        (_, idx) => existingTimes[idx] ?? defaults[idx] ?? "08:00"
      );
      setMedSlotTimes(merged);
      setMedStartTime(merged[0] ?? "08:00");
    } else {
      const firstTime = existingTimes[0] ?? clusterAnchors[0] ?? "08:00";
      setMedSlotTimes([firstTime]);
      setMedStartTime(firstTime);
    }

    setMedStock(med.current_stock === null ? "" : String(med.current_stock));
    setMedUnitsPkg(
      med.units_per_package === null ? "" : String(med.units_per_package)
    );
    setMedPrice(med.package_price === null ? "" : String(med.package_price));
    setMedPharmacy(med.preferred_pharmacy ?? "");
    setMedPriority(String(med.purchase_priority));
    setMedBufferDays(String(med.safety_buffer_days));
    setMedNotes(med.clinical_notes ?? "");
    setMedFormError(null);
    setMedModalOpen(true);
  }

  function handleFrequencyTypeChange(nextType: MedFrequencyType) {
    setMedFreqType(nextType);
    if (nextType === "DAILY_SLOTS") {
      const count = Math.max(1, Math.min(8, Number.parseInt(medFreqVal || "1", 10) || 1));
      setMedEventLinkedOnly(false);
      setMedSlotTimes((prev) => {
        const fallback = buildInitialSlots(count, clusterAnchors);
        return Array.from({ length: count }, (_, i) => prev[i] ?? fallback[i]);
      });
    } else if (nextType === "FIXED_HOURS") {
      setMedEventLinkedOnly(false);
      if (!medFreqVal || Number.parseInt(medFreqVal, 10) < 2) {
        setMedFreqVal("8");
      }
    }
  }

  function handleFrequencyValChange(raw: string) {
    setMedFreqVal(raw);
    if (medFreqType === "DAILY_SLOTS") {
      const count = Math.max(1, Math.min(8, Number.parseInt(raw || "1", 10) || 1));
      setMedSlotTimes((prev) => {
        const fallback = buildInitialSlots(count, clusterAnchors);
        return Array.from({ length: count }, (_, i) => prev[i] ?? fallback[i]);
      });
    }
  }

  function toggleWeekday(dayNum: number) {
    setMedActiveDays((prev) => {
      const current = prev === null ? [...WEEKDAY_ORDER] : [...prev];
      const exists = current.includes(dayNum);
      const next = exists
        ? current.filter((d) => d !== dayNum)
        : [...current, dayNum];
      return normalizeActiveDays(next);
    });
  }

  async function handleSaveMedicationSubmit(e: FormEvent) {
    e.preventDefault();
    setMedFormError(null);

    const trimmedName = medName.trim();
    if (!trimmedName) {
      setMedFormError("Ingresa el nombre del medicamento.");
      return;
    }

    const parsedDose = parseOptionalNumber(medDose);
    if (parsedDose === null || parsedDose <= 0) {
      setMedFormError("La dosis por toma debe ser mayor a 0 (ej. 1 o 0.5).");
      return;
    }

    const parsedFreqVal = Number.parseInt(medFreqVal, 10);
    if (!Number.isFinite(parsedFreqVal) || parsedFreqVal <= 0) {
      setMedFormError("La frecuencia debe ser un numero entero positivo.");
      return;
    }

    const parsedStock = parseOptionalNumber(medStock);
    if (parsedStock !== null && parsedStock < 0) {
      setMedFormError("El inventario actual no puede ser negativo.");
      return;
    }

    const parsedUnitsPkg = parseOptionalNumber(medUnitsPkg);
    if (parsedUnitsPkg !== null && parsedUnitsPkg <= 0) {
      setMedFormError("Las unidades por caja deben ser mayores a 0.");
      return;
    }

    const parsedPrice = parseOptionalNumber(medPrice);
    if (parsedPrice !== null && parsedPrice < 0) {
      setMedFormError("El precio por caja no puede ser negativo.");
      return;
    }

    const isDailyOrFixed =
      medFreqType === "DAILY_SLOTS" || medFreqType === "FIXED_HOURS";

    const idealTimes = medEventLinkedOnly
      ? []
      : medFreqType === "DAILY_SLOTS"
      ? medSlotTimes.slice(0, parsedFreqVal).map((t) => `${t}:00`.slice(0, 8))
      : [`${medStartTime}:00`.slice(0, 8)];

    const payload: SaveMedicationPayload = {
      ...(editingMed ? { id: editingMed.id } : {}),
      name: trimmedName,
      active_ingredient: medIngredient.trim() || null,
      presentation: medPresentation.trim() || "Tabletas",
      units_per_package: parsedUnitsPkg,
      package_price: parsedPrice,
      dose_amount: parsedDose,
      current_stock: parsedStock,
      frequency_type: medFreqType,
      frequency_value: parsedFreqVal,
      tolerance_window_mins: Math.max(
        0,
        Math.min(180, Number.parseInt(medTolerance || "45", 10) || 45)
      ),
      intake_rule: medRule,
      active_days: isDailyOrFixed ? normalizeActiveDays(medActiveDays) : null,
      schedule_start_date: isDailyOrFixed
        ? null
        : medScheduleStart.trim() || null,
      event_linked_only: medEventLinkedOnly,
      preferred_pharmacy: medPharmacy.trim() || null,
      purchase_priority: Math.max(
        1,
        Math.min(3, Number.parseInt(medPriority || "2", 10) || 2)
      ),
      safety_buffer_days: Math.max(
        1,
        Math.min(60, Number.parseInt(medBufferDays || "7", 10) || 7)
      ),
      clinical_notes: medNotes.trim() || null,
      ideal_times: idealTimes,
    };

    setSavingMed(true);
    try {
      await onSaveMedication(payload);
      setMedModalOpen(false);
    } catch (err) {
      setMedFormError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar el medicamento."
      );
    } finally {
      setSavingMed(false);
    }
  }

  function openRestockModal(med: Medication) {
    setRestockTarget(med);
    const defaultQty = med.units_per_package ?? 30;
    setRestockQty(String(defaultQty));
    setRestockUnitsPkg(
      med.units_per_package !== null ? String(med.units_per_package) : String(defaultQty)
    );
    setRestockPkgPrice(med.package_price !== null ? String(med.package_price) : "");
    setRestockExpenseAmount(
      med.package_price !== null ? String(med.package_price) : ""
    );
    setRestockPharmacy(med.preferred_pharmacy ?? "");
    setRestockPaymentMethod("Tarjeta");
    setRestockLogExpense(true);
    setRestockError(null);
  }

  async function handleRestockSubmit(e: FormEvent) {
    e.preventDefault();
    if (!restockTarget) return;
    setRestockError(null);

    const qty = parseOptionalNumber(restockQty);
    if (qty === null || qty <= 0) {
      setRestockError("Ingresa una cantidad valida mayor a 0.");
      return;
    }

    const unitsPkg = parseOptionalNumber(restockUnitsPkg);
    const pkgPrice = parseOptionalNumber(restockPkgPrice);
    const expenseAmt = parseOptionalNumber(restockExpenseAmount);

    setSavingRestock(true);
    try {
      await onRestockMedication(restockTarget.id, qty, {
        units_per_package: unitsPkg,
        package_price: pkgPrice,
        expense_amount: restockLogExpense ? expenseAmt : null,
        provider_or_pharmacy: restockPharmacy.trim() || null,
        payment_method: restockPaymentMethod.trim() || null,
        log_expense: restockLogExpense && expenseAmt !== null && expenseAmt >= 0,
      });
      setRestockTarget(null);
    } catch (err) {
      setRestockError(
        err instanceof Error ? err.message : "No se pudo registrar el restock."
      );
    } finally {
      setSavingRestock(false);
    }
  }

  function openAdjustModal(med: Medication) {
    setAdjustTarget(med);
    setAdjustUnknown(med.current_stock === null);
    setAdjustStockVal(
      med.current_stock === null ? "0" : String(med.current_stock)
    );
    setAdjustReason("Conteo fisico manual");
    setAdjustError(null);
  }

  async function handleAdjustSubmit(e: FormEvent) {
    e.preventDefault();
    if (!adjustTarget) return;
    setAdjustError(null);

    const exact = adjustUnknown ? null : parseOptionalNumber(adjustStockVal);
    if (!adjustUnknown && (exact === null || exact < 0)) {
      setAdjustError("Ingresa un conteo fisico mayor o igual a 0.");
      return;
    }

    setSavingAdjust(true);
    try {
      await onAdjustStock(
        adjustTarget.id,
        exact,
        adjustReason.trim() || "Conteo fisico manual"
      );
      setAdjustTarget(null);
    } catch (err) {
      setAdjustError(
        err instanceof Error ? err.message : "Error al ajustar inventario."
      );
    } finally {
      setSavingAdjust(false);
    }
  }

  async function handleArchiveSubmit(e: FormEvent) {
    e.preventDefault();
    if (!archiveTarget) return;
    setArchiveError(null);
    setSavingArchive(true);
    try {
      await onArchiveMedication(
        archiveTarget.id,
        archiveReason.trim() || null
      );
      setArchiveTarget(null);
    } catch (err) {
      setArchiveError(
        err instanceof Error ? err.message : "Error al archivar medicamento."
      );
    } finally {
      setSavingArchive(false);
    }
  }

  function openClustersModal() {
    setEditingCluster(null);
    setClusterLabel("");
    setClusterAnchor("15:00");
    setClusterRule("WITH_FOOD");
    setClusterActive(true);
    setClusterError(null);
    setConfirmDeleteClusterId(null);
    setClustersModalOpen(true);
  }

  function startEditCluster(cluster: IntakeCluster) {
    setEditingCluster(cluster);
    setClusterLabel(cluster.label);
    setClusterAnchor(formatShortTime(cluster.anchor_time));
    setClusterRule(cluster.intake_rule);
    setClusterActive(cluster.is_active);
    setClusterError(null);
  }

  async function handleClusterSubmit(e: FormEvent) {
    e.preventDefault();
    setClusterError(null);
    if (!clusterLabel.trim()) {
      setClusterError("Ingresa el nombre del bloque horario.");
      return;
    }

    setSavingCluster(true);
    try {
      if (editingCluster) {
        await onUpdateCluster(editingCluster.id, {
          label: clusterLabel.trim(),
          anchor_time: clusterAnchor,
          intake_rule: clusterRule,
          is_active: clusterActive,
        });
      } else {
        await onCreateCluster({
          label: clusterLabel.trim(),
          anchor_time: clusterAnchor,
          intake_rule: clusterRule,
        });
      }
      setEditingCluster(null);
      setClusterLabel("");
    } catch (err) {
      setClusterError(
        err instanceof Error ? err.message : "No se pudo guardar el bloque."
      );
    } finally {
      setSavingCluster(false);
    }
  }

  return (
    <div className="space-y-5 clinical-enter">
      {/* Encabezado y Acciones Principales */}
      <section className="clinical-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-[#0F172A]">
              Catalogo de Medicamentos e Inventario
            </h2>
            <p className="mt-1 text-[14px] text-[#475569]">
              Gestion de dosis, periodicidad inteligente por dia de la semana,
              horarios unificados e inventario en farmacia.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IconActionButton
              icon={Clock}
              label="Configurar bloques horarios (Desayuno / 15:00 / Cena)"
              shortLabel={`Bloques (${snapshot.clusters.filter((c) => c.is_active).length})`}
              tone="neutral"
              onClick={openClustersModal}
            />

            <IconActionButton
              icon={RefreshCw}
              label="Sincronizar y generar tomas pendientes de hoy"
              shortLabel="Generar tomas"
              tone="info"
              loading={busyKey === "gen-today"}
              onClick={async () => {
                setBusyKey("gen-today");
                try {
                  await onGenerateTodayLogs();
                } catch {
                  // Toast global
                } finally {
                  setBusyKey(null);
                }
              }}
            />

            <IconActionButton
              icon={Plus}
              label="Registrar nuevo medicamento en el catalogo"
              shortLabel="Nuevo Medicamento"
              tone="primary"
              onClick={openCreateMedicationModal}
            />
          </div>
        </div>

        {/* Barra de Busqueda + Leyenda de Simbolos */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E2E8F0]">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
            <label htmlFor="med-search" className="sr-only">
              Buscar medicamento, principio activo o farmacia
            </label>
            <input
              id="med-search"
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre, principio activo o farmacia..."
              className="clinical-input max-w-md bg-white border border-[#CBD5E1] px-3 text-[14px]"
            />

            {isAdmin && snapshot.archived_medications.length > 0 && (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="clinical-btn px-3 border border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[13px] font-medium text-[#334155]"
              >
                {showArchived
                  ? "Ocultar archivados"
                  : `Ver archivados (${snapshot.archived_medications.length})`}
              </button>
            )}
          </div>

          <div
            aria-label="Guia visual de acciones"
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 rounded-[6px]"
          >
            <span className="font-semibold text-[#0F172A]">Simbolos:</span>
            <span className="inline-flex items-center gap-1">
              <PackagePlus className="w-3.5 h-3.5 text-[#065F46]" aria-hidden="true" />
              Restock
            </span>
            <span className="inline-flex items-center gap-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#0E7490]" aria-hidden="true" />
              Ajuste stock
            </span>
            <span className="inline-flex items-center gap-1">
              <Edit3 className="w-3.5 h-3.5 text-[#334155]" aria-hidden="true" />
              Editar esquema
            </span>
            {isAdmin && (
              <>
                <span className="inline-flex items-center gap-1">
                  <History className="w-3.5 h-3.5 text-[#92400E]" aria-hidden="true" />
                  Versiones
                </span>
                <span className="inline-flex items-center gap-1">
                  <Archive className="w-3.5 h-3.5 text-[#92400E]" aria-hidden="true" />
                  Archivar
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Lista Activa de Medicamentos */}
      <section aria-label="Medicamentos activos" className="space-y-3">
        {filteredMeds.length === 0 ? (
          <div className="clinical-card p-8 text-center text-[14px] text-[#475569]">
            No se encontraron medicamentos con el filtro actual.
          </div>
        ) : (
          filteredMeds.map((med) => {
            const normalizedDays = normalizeActiveDays(med.active_days);
            const isCriticalStock =
              med.days_of_supply_remaining !== null &&
              med.days_of_supply_remaining <= med.safety_buffer_days;
            const isUnknownStock = med.current_stock === null;
            const isUnknownPrice =
              med.package_price === null || med.units_per_package === null;
            const isEventLinked =
              (med.frequency_type === "INTERVAL_DAYS" ||
                med.frequency_type === "INTERVAL_WEEKS") &&
              (!med.schedules || med.schedules.length === 0);

            const verMeta = versionsByMedId.get(med.id);

            return (
              <article
                key={med.id}
                className={cn(
                  "clinical-card p-5 transition-colors",
                  isCriticalStock && "border-[#FECACA] bg-[#FEF2F2]/35"
                )}
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  {/* Columna Informacion Clinica */}
                  <div className="space-y-2.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[17px] font-bold text-[#0F172A]">
                        {med.name}
                      </h3>
                      <StatusBadge
                        label={INTAKE_RULE_TAG[med.intake_rule]}
                        tone={med.intake_rule === "FASTING" ? "warn" : "neutral"}
                      />
                      <StatusBadge
                        label={
                          PURCHASE_PRIORITY_TAG[med.purchase_priority] ??
                          "[PRIORIDAD]"
                        }
                        tone={med.purchase_priority === 1 ? "crit" : "neutral"}
                      />
                      {isUnknownStock ? (
                        <StatusBadge label="[STOCK PENDIENTE]" tone="warn" />
                      ) : isCriticalStock ? (
                        <StatusBadge
                          label={`[CRITICO: ${med.days_of_supply_remaining}d]`}
                          tone="crit"
                        />
                      ) : (
                        <StatusBadge
                          label={`[COBERTURA: ${med.days_of_supply_remaining ?? "--"}d]`}
                          tone="ok"
                        />
                      )}
                      {isUnknownPrice && (
                        <StatusBadge label="[PRECIO PENDIENTE]" tone="info" />
                      )}
                    </div>

                    <p className="text-[14px] text-[#334155]">
                      {med.active_ingredient
                        ? `${med.active_ingredient} | `
                        : ""}
                      <span className="font-semibold text-[#0F172A]">
                        Dosis: {med.dose_amount} {med.presentation}
                      </span>{" "}
                      | {FREQUENCY_TYPE_LABEL[med.frequency_type]}:{" "}
                      <span className="font-mono font-semibold text-[#0F172A]">
                        {med.frequency_value}
                      </span>{" "}
                      | Consumo real:{" "}
                      <span className="font-mono font-semibold text-[#0E7490] tabular-nums">
                        {med.daily_consumption_rate}/dia
                      </span>
                    </p>

                    {/* Periodicidad Inteligente + Horarios */}
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      {(med.frequency_type === "DAILY_SLOTS" ||
                        med.frequency_type === "FIXED_HOURS") && (
                        <div className="inline-flex flex-wrap items-center gap-1 bg-[#F8FAFC] border border-[#E2E8F0] px-2.5 py-1.5 rounded-[4px]">
                          <span className="text-[#475569] font-medium mr-1">
                            Dias:
                          </span>
                          {WEEKDAY_ORDER.map((dayNum) => {
                            const active =
                              normalizedDays === null ||
                              normalizedDays.includes(dayNum);
                            return (
                              <span
                                key={dayNum}
                                title={WEEKDAY_LABEL[dayNum]}
                                className={cn(
                                  "px-1.5 py-0.5 rounded-[3px] font-mono text-[11px] font-bold",
                                  active
                                    ? "bg-[#ECFEFF] text-[#155E75] border border-[#A5F3FC]"
                                    : "bg-[#F1F5F9] text-[#94A3B8] line-through"
                                )}
                              >
                                {WEEKDAY_TWO_CHAR[dayNum]}
                              </span>
                            );
                          })}
                          <span className="ml-1 text-[12px] text-[#0F172A] font-semibold">
                            ({formatActiveDaysLabel(med.active_days)})
                          </span>
                        </div>
                      )}

                      {isEventLinked ? (
                        <span className="inline-flex items-center gap-1.5 bg-[#F8FAFC] border border-[#CBD5E1] px-2.5 py-1.5 rounded-[4px] text-[#334155] font-medium">
                          <CalendarClock
                            className="w-3.5 h-3.5 text-[#0E7490]"
                            aria-hidden="true"
                          />
                          Vinculado a agenda/citas (sin toma diaria fija)
                          {med.schedule_start_date && (
                            <span className="font-mono text-[12px] text-[#64748B]">
                              | Inicio: {med.schedule_start_date.slice(0, 10)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <div className="inline-flex flex-wrap items-center gap-1.5 bg-[#F8FAFC] border border-[#E2E8F0] px-2.5 py-1.5 rounded-[4px]">
                          <span className="text-[#475569] font-medium">
                            Horarios:
                          </span>
                          {(med.schedules ?? []).map((sch) => (
                            <span
                              key={sch.schedule_id}
                              className="font-mono text-[12px] px-1.5 py-0.5 rounded-[3px] bg-white border border-[#CBD5E1] text-[#0F172A]"
                            >
                              {formatShortTime(sch.effective_clustered_time)}
                              {sch.cluster_label
                                ? ` (${sch.cluster_label})`
                                : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Inventario y Comercial */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-[#475569]">
                      <span>
                        Stock actual:{" "}
                        <strong className="font-mono text-[#0F172A] tabular-nums">
                          {med.current_stock === null
                            ? "Por definir"
                            : `${med.current_stock} ${med.presentation}`}
                        </strong>
                      </span>
                      <span>
                        Presentacion:{" "}
                        <strong className="font-mono text-[#0F172A] tabular-nums">
                          {med.units_per_package === null
                            ? "Por definir"
                            : `${med.units_per_package} u/caja`}
                        </strong>
                      </span>
                      <span>
                        Precio caja:{" "}
                        <strong className="font-mono text-[#0F172A] tabular-nums">
                          {formatCurrencyMxn(med.package_price)}
                        </strong>
                      </span>
                      {med.preferred_pharmacy && (
                        <span>
                          Farmacia:{" "}
                          <strong className="text-[#0F172A]">
                            {med.preferred_pharmacy}
                          </strong>
                        </span>
                      )}
                    </div>

                    {med.clinical_notes && (
                      <p className="text-[13px] text-[#475569] bg-[#F8FAFC] border-l-2 border-[#0E7490] px-3 py-1.5">
                        {med.clinical_notes}
                      </p>
                    )}
                  </div>

                  {/* Columna Botones Inteligentes por Simbolo */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0 pt-1">
                    <IconActionButton
                      icon={PackagePlus}
                      label={`Registrar restock o compra de ${med.name}`}
                      tone="success"
                      onClick={() => openRestockModal(med)}
                    />

                    <IconActionButton
                      icon={SlidersHorizontal}
                      label={`Ajustar conteo fisico de ${med.name}`}
                      tone="info"
                      onClick={() => openAdjustModal(med)}
                    />

                    <IconActionButton
                      icon={Edit3}
                      label={`Editar dosis, horarios y periodicidad de ${med.name}`}
                      tone="neutral"
                      onClick={() => openEditMedicationModal(med)}
                    />

                    {isAdmin && (
                      <>
                        <IconActionButton
                          icon={History}
                          label={
                            verMeta && verMeta.unreviewed > 0
                              ? `Historial de versiones de ${med.name} (${verMeta.unreviewed} cambios del paciente sin revisar)`
                              : `Historial de versiones de ${med.name} (${verMeta?.total ?? 0})`
                          }
                          tone={
                            verMeta && verMeta.unreviewed > 0 ? "warn" : "neutral"
                          }
                          badgeDot={Boolean(verMeta && verMeta.unreviewed > 0)}
                          onClick={() => setVersionsTarget(med)}
                        />

                        <IconActionButton
                          icon={Archive}
                          label={`Archivar o suspender ${med.name}`}
                          tone="warn"
                          onClick={() => {
                            setArchiveTarget(med);
                            setArchiveReason("");
                            setArchiveError(null);
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      {/* Medicamentos Archivados (Solo Administrador) */}
      {isAdmin && showArchived && snapshot.archived_medications.length > 0 && (
        <section className="clinical-card p-5 space-y-3 border-dashed border-[#CBD5E1]">
          <h3 className="text-[16px] font-bold text-[#0F172A]">
            Tratamientos Archivados / Suspendidos ({snapshot.archived_medications.length})
          </h3>
          <div className="space-y-2.5">
            {snapshot.archived_medications.map((med) => {
              const isConfirmDelete = confirmDeleteMedId === med.id;
              return (
                <div
                  key={med.id}
                  className="p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px] flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-[15px] text-[#0F172A]">
                      {med.name}{" "}
                      <span className="font-normal text-[13px] text-[#475569]">
                        ({med.dose_amount} {med.presentation})
                      </span>
                    </p>
                    {med.discontinuation_reason && (
                      <p className="text-[13px] text-[#64748B]">
                        Motivo: {med.discontinuation_reason}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <IconActionButton
                      icon={RotateCcw}
                      label={`Reactivar ${med.name}`}
                      shortLabel="Reactivar"
                      tone="info"
                      loading={busyKey === `restore:${med.id}`}
                      onClick={async () => {
                        setBusyKey(`restore:${med.id}`);
                        try {
                          await onRestoreMedication(med.id);
                        } catch {
                          // Toast
                        } finally {
                          setBusyKey(null);
                        }
                      }}
                    />

                    {isConfirmDelete ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyKey === `del:${med.id}`}
                          onClick={async () => {
                            setBusyKey(`del:${med.id}`);
                            try {
                              await onDeleteMedication(med.id);
                              setConfirmDeleteMedId(null);
                            } catch {
                              // Toast
                            } finally {
                              setBusyKey(null);
                            }
                          }}
                          className="clinical-btn px-3 bg-[#991B1B] text-white text-[12px] font-bold"
                        >
                          Confirmar borrado
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteMedId(null)}
                          className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white text-[#334155] text-[12px]"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <IconActionButton
                        icon={Trash2}
                        label={`Eliminar permanentemente ${med.name}`}
                        tone="danger"
                        onClick={() => setConfirmDeleteMedId(med.id)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Modal: Crear / Editar Medicamento */}
      <ClinicalModal
        open={medModalOpen}
        onClose={() => !savingMed && setMedModalOpen(false)}
        title={
          editingMed
            ? `Editar Medicamento: ${editingMed.name}`
            : "Registrar Nuevo Medicamento"
        }
        subtitle="Configura dosis, esquema horario, dias de la semana y datos comerciales opcionales."
        maxWidthClass="max-w-4xl"
      >
        <form onSubmit={handleSaveMedicationSubmit} className="space-y-5">
          {medFormError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px] flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{medFormError}</span>
            </div>
          )}

          {/* Seccion 1: Identificacion Clinica */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="sm:col-span-2">
              <label
                htmlFor="med-name"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Nombre del medicamento *
              </label>
              <input
                id="med-name"
                type="text"
                required
                value={medName}
                onChange={(e) => setMedName(e.target.value)}
                placeholder="Ej. Valproato semisodico 500 mg"
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="med-ingredient"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Principio activo / Concentracion
              </label>
              <input
                id="med-ingredient"
                type="text"
                value={medIngredient}
                onChange={(e) => setMedIngredient(e.target.value)}
                placeholder="Ej. Divalproato de sodio 500 mg"
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="med-presentation"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Presentacion *
              </label>
              <input
                id="med-presentation"
                list="med-presentation-options"
                required
                value={medPresentation}
                onChange={(e) => setMedPresentation(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
              <datalist id="med-presentation-options">
                <option value="Tabletas" />
                <option value="Capsulas" />
                <option value="Comprimidos" />
                <option value="Ampolleta / Inyeccion" />
                <option value="Sobres" />
                <option value="Gotas" />
                <option value="Mililitros" />
              </datalist>
            </div>

            <div>
              <label
                htmlFor="med-dose"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Dosis por toma *
              </label>
              <input
                id="med-dose"
                type="number"
                step="any"
                min="0.01"
                required
                value={medDose}
                onChange={(e) => setMedDose(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="med-rule"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Regla gastronomica
              </label>
              <select
                id="med-rule"
                value={medRule}
                onChange={(e) => setMedRule(e.target.value as IntakeConstraint)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
              >
                {(
                  [
                    "NONE",
                    "FASTING",
                    "WITH_FOOD",
                    "SEPARATE_FROM_OTHERS",
                  ] as IntakeConstraint[]
                ).map((rule) => (
                  <option key={rule} value={rule}>
                    {INTAKE_RULE_LABEL[rule]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="med-tolerance"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Tolerancia de agrupacion (min)
              </label>
              <input
                id="med-tolerance"
                type="number"
                min="0"
                max="180"
                value={medTolerance}
                onChange={(e) => setMedTolerance(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
          </div>

          {/* Seccion 2: Periodicidad Inteligente y Horarios */}
          <div className="p-4 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[14px] font-bold text-[#0F172A]">
                Periodicidad y Horarios de Toma
              </h4>
              <span className="font-mono text-[12px] text-[#0E7490] font-semibold">
                Consumo real: {previewRate} u/dia
                {previewSupplyDays !== null
                  ? ` | Duracion estimada: ${previewSupplyDays} dias`
                  : ""}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label
                  htmlFor="med-freq-type"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Tipo de periodicidad
                </label>
                <select
                  id="med-freq-type"
                  value={medFreqType}
                  onChange={(e) =>
                    handleFrequencyTypeChange(e.target.value as MedFrequencyType)
                  }
                  className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
                >
                  {(
                    [
                      "DAILY_SLOTS",
                      "FIXED_HOURS",
                      "INTERVAL_DAYS",
                      "INTERVAL_WEEKS",
                    ] as MedFrequencyType[]
                  ).map((ft) => (
                    <option key={ft} value={ft}>
                      {FREQUENCY_TYPE_LABEL[ft]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="med-freq-val"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  {medFreqType === "DAILY_SLOTS"
                    ? "Tomas por dia activo"
                    : medFreqType === "FIXED_HOURS"
                    ? "Intervalo en horas (ej. 8 o 12)"
                    : medFreqType === "INTERVAL_DAYS"
                    ? "Intervalo en dias (ej. 21)"
                    : "Intervalo en semanas"}
                </label>
                <input
                  id="med-freq-val"
                  type="number"
                  min="1"
                  max={medFreqType === "DAILY_SLOTS" ? 8 : 365}
                  required
                  value={medFreqVal}
                  onChange={(e) => handleFrequencyValChange(e.target.value)}
                  className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px] bg-white"
                />
              </div>
            </div>

            {/* Selector de Dias de la Semana */}
            {(medFreqType === "DAILY_SLOTS" || medFreqType === "FIXED_HOURS") && (
              <div className="space-y-2.5 pt-2 border-t border-[#E2E8F0]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#0F172A]">
                    Dias de la semana que se toma ({formatActiveDaysLabel(medActiveDays)})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_SCHEDULE_PRESETS.map((preset) => {
                      const selected = activeDaysEqual(medActiveDays, preset.days);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setMedActiveDays(preset.days)}
                          className={cn(
                            "px-2.5 py-1 rounded-[4px] border text-[12px] font-medium cursor-pointer",
                            selected
                              ? "bg-[#0E7490] border-[#0E7490] text-white"
                              : "bg-white border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9]"
                          )}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {WEEKDAY_ORDER.map((dayNum) => {
                    const isChecked =
                      medActiveDays === null || medActiveDays.includes(dayNum);
                    return (
                      <button
                        key={dayNum}
                        type="button"
                        aria-pressed={isChecked}
                        aria-label={`${WEEKDAY_LABEL[dayNum]} (${isChecked ? "activo" : "descanso"})`}
                        onClick={() => toggleWeekday(dayNum)}
                        className={cn(
                          "min-w-[44px] min-h-[44px] px-3 rounded-[6px] border font-mono text-[13px] font-bold cursor-pointer transition-colors",
                          isChecked
                            ? "bg-[#ECFEFF] border-[#0E7490] text-[#0E7490]"
                            : "bg-white border-[#CBD5E1] text-[#94A3B8] hover:text-[#334155]"
                        )}
                      >
                        {WEEKDAY_TWO_CHAR[dayNum]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Horarios segun Frecuencia */}
            {medFreqType === "DAILY_SLOTS" && (
              <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#0F172A]">
                    Horarios diarios ideales (se agrupan a bloques cercanos)
                  </span>
                  {clusterAnchors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const count = Math.max(
                          1,
                          Math.min(8, Number.parseInt(medFreqVal || "1", 10) || 1)
                        );
                        setMedSlotTimes(buildInitialSlots(count, clusterAnchors));
                      }}
                      className="text-[12px] font-semibold text-[#0E7490] hover:underline cursor-pointer"
                    >
                      Alinear a bloques activos ({clusterAnchors.join(", ")})
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {medSlotTimes.map((timeVal, idx) => (
                    <div key={idx}>
                      <label
                        htmlFor={`med-slot-${idx}`}
                        className="block text-[12px] text-[#475569] mb-1"
                      >
                        Toma #{idx + 1}
                      </label>
                      <input
                        id={`med-slot-${idx}`}
                        type="time"
                        required
                        value={timeVal}
                        onChange={(e) => {
                          const next = [...medSlotTimes];
                          next[idx] = e.target.value;
                          setMedSlotTimes(next);
                        }}
                        className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px] bg-white"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {medFreqType === "FIXED_HOURS" && (
              <div className="pt-2 border-t border-[#E2E8F0]">
                <label
                  htmlFor="med-start-time"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Hora de primera toma del ciclo
                </label>
                <input
                  id="med-start-time"
                  type="time"
                  required
                  value={medStartTime}
                  onChange={(e) => setMedStartTime(e.target.value)}
                  className="clinical-input max-w-[200px] border border-[#CBD5E1] px-3 font-mono text-[14px] bg-white"
                />
              </div>
            )}

            {(medFreqType === "INTERVAL_DAYS" ||
              medFreqType === "INTERVAL_WEEKS") && (
              <div className="space-y-3 pt-2 border-t border-[#E2E8F0]">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    id="med-event-linked"
                    type="checkbox"
                    checked={medEventLinkedOnly}
                    onChange={(e) => setMedEventLinkedOnly(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-[#0E7490]"
                  />
                  <span className="text-[13px] text-[#0F172A] font-medium">
                    Aplicacion clinica vinculada unicamente a Citas / Agenda
                    (ejemplo: Inyeccion Fluanxol cada 21 dias sin toma diaria en bloques)
                  </span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor="med-schedule-start"
                      className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                    >
                      Fecha ancla de inicio del ciclo
                    </label>
                    <input
                      id="med-schedule-start"
                      type="date"
                      value={medScheduleStart}
                      onChange={(e) => setMedScheduleStart(e.target.value)}
                      className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px] bg-white"
                    />
                  </div>

                  {!medEventLinkedOnly && (
                    <div>
                      <label
                        htmlFor="med-interval-time"
                        className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                      >
                        Hora de toma en dias activos
                      </label>
                      <input
                        id="med-interval-time"
                        type="time"
                        value={medStartTime}
                        onChange={(e) => setMedStartTime(e.target.value)}
                        className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px] bg-white"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Seccion 3: Inventario y Costos (Diferibles) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] text-[#475569]">
              <Info className="w-4 h-4 text-[#0E7490] shrink-0" aria-hidden="true" />
              <span>
                Campos comerciales e inventario opcionales: si aun no compras el
                medicamento o desconoces el precio, dejalos en blanco y completalos despues.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label
                  htmlFor="med-stock"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Inventario actual
                </label>
                <input
                  id="med-stock"
                  type="number"
                  step="any"
                  min="0"
                  value={medStock}
                  onChange={(e) => setMedStock(e.target.value)}
                  placeholder="Opcional"
                  className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
                />
              </div>

              <div>
                <label
                  htmlFor="med-units-pkg"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Unidades por caja
                </label>
                <input
                  id="med-units-pkg"
                  type="number"
                  step="any"
                  min="0.1"
                  value={medUnitsPkg}
                  onChange={(e) => setMedUnitsPkg(e.target.value)}
                  placeholder="Opcional"
                  className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
                />
              </div>

              <div>
                <label
                  htmlFor="med-price"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Precio por caja (MXN)
                </label>
                <input
                  id="med-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={medPrice}
                  onChange={(e) => setMedPrice(e.target.value)}
                  placeholder="Opcional"
                  className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
                />
              </div>

              <div>
                <label
                  htmlFor="med-pharmacy"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Farmacia preferida
                </label>
                <input
                  id="med-pharmacy"
                  type="text"
                  value={medPharmacy}
                  onChange={(e) => setMedPharmacy(e.target.value)}
                  placeholder="Ej. Farmacia San Pablo"
                  className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
                />
              </div>

              <div>
                <label
                  htmlFor="med-priority"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Prioridad de compra
                </label>
                <select
                  id="med-priority"
                  value={medPriority}
                  onChange={(e) => setMedPriority(e.target.value)}
                  className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
                >
                  <option value="1">1 - Esencial / Critico</option>
                  <option value="2">2 - Prioridad Media</option>
                  <option value="3">3 - Suplemento / Flexible</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="med-buffer"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Colchon de seguridad (dias)
                </label>
                <input
                  id="med-buffer"
                  type="number"
                  min="1"
                  max="60"
                  value={medBufferDays}
                  onChange={(e) => setMedBufferDays(e.target.value)}
                  className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="med-notes"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Indicaciones clinicas
                </label>
                <input
                  id="med-notes"
                  type="text"
                  value={medNotes}
                  onChange={(e) => setMedNotes(e.target.value)}
                  placeholder="Observaciones medicas, ajustes del doctor..."
                  className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              disabled={savingMed}
              onClick={() => setMedModalOpen(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px] font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingMed}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold inline-flex items-center gap-2"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              {savingMed
                ? "Guardando..."
                : editingMed
                ? "Guardar Cambios"
                : "Registrar Medicamento"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Registrar Restock */}
      <ClinicalModal
        open={Boolean(restockTarget)}
        onClose={() => !savingRestock && setRestockTarget(null)}
        title={`Registrar Restock: ${restockTarget?.name ?? ""}`}
        subtitle="Suma unidades al inventario y opcionalmente registra el gasto en finanzas."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleRestockSubmit} className="space-y-4">
          {restockError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
            >
              {restockError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="restock-qty"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Unidades recibidas *
              </label>
              <input
                id="restock-qty"
                type="number"
                step="any"
                min="0.1"
                required
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="restock-units-pkg"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Unidades por caja (actualizar catalogo)
              </label>
              <input
                id="restock-units-pkg"
                type="number"
                step="any"
                min="0.1"
                value={restockUnitsPkg}
                onChange={(e) => setRestockUnitsPkg(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="restock-pkg-price"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Precio por caja (MXN)
              </label>
              <input
                id="restock-pkg-price"
                type="number"
                step="0.01"
                min="0"
                value={restockPkgPrice}
                onChange={(e) => {
                  setRestockPkgPrice(e.target.value);
                  if (!restockExpenseAmount) {
                    setRestockExpenseAmount(e.target.value);
                  }
                }}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="restock-pharmacy"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Farmacia / Proveedor
              </label>
              <input
                id="restock-pharmacy"
                type="text"
                value={restockPharmacy}
                onChange={(e) => setRestockPharmacy(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-[#0F172A] font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={restockLogExpense}
              onChange={(e) => setRestockLogExpense(e.target.checked)}
              className="w-4 h-4 accent-[#0E7490]"
            />
            Registrar automaticamente el pago en el Modulo Financiero
          </label>

          {restockLogExpense && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-3 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0]">
              <div>
                <label
                  htmlFor="restock-expense"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Total pagado (MXN)
                </label>
                <input
                  id="restock-expense"
                  type="number"
                  step="0.01"
                  min="0"
                  value={restockExpenseAmount}
                  onChange={(e) => setRestockExpenseAmount(e.target.value)}
                  className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px] bg-white"
                />
              </div>

              <div>
                <label
                  htmlFor="restock-method"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Metodo de pago
                </label>
                <input
                  id="restock-method"
                  type="text"
                  value={restockPaymentMethod}
                  onChange={(e) => setRestockPaymentMethod(e.target.value)}
                  className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setRestockTarget(null)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingRestock}
              className="clinical-btn px-4 bg-[#065F46] hover:bg-[#047857] text-white text-[14px] font-semibold"
            >
              {savingRestock ? "Guardando..." : "Confirmar Restock"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Ajuste Fisico de Stock */}
      <ClinicalModal
        open={Boolean(adjustTarget)}
        onClose={() => !savingAdjust && setAdjustTarget(null)}
        title={`Ajuste Fisico de Stock: ${adjustTarget?.name ?? ""}`}
        subtitle="Establece la cantidad exacta contada en caja (no modifica los gastos historicos)."
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-4">
          {adjustError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
            >
              {adjustError}
            </div>
          )}

          <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
            <input
              type="checkbox"
              checked={adjustUnknown}
              onChange={(e) => setAdjustUnknown(e.target.checked)}
              className="w-4 h-4 accent-[#0E7490]"
            />
            Marcar inventario como &quot;Por definir&quot; (aun sin conteo)
          </label>

          {!adjustUnknown && (
            <div>
              <label
                htmlFor="adjust-stock-val"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Cantidad exacta ({adjustTarget?.presentation ?? "unidades"})
              </label>
              <input
                id="adjust-stock-val"
                type="number"
                step="any"
                min="0"
                required
                value={adjustStockVal}
                onChange={(e) => setAdjustStockVal(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="adjust-reason"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Motivo del ajuste
            </label>
            <input
              id="adjust-reason"
              type="text"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setAdjustTarget(null)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingAdjust}
              className="clinical-btn px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold"
            >
              {savingAdjust ? "Aplicando..." : "Guardar Ajuste"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Archivar Medicamento (Admin) */}
      <ClinicalModal
        open={Boolean(archiveTarget)}
        onClose={() => !savingArchive && setArchiveTarget(null)}
        title={`Archivar Tratamiento: ${archiveTarget?.name ?? ""}`}
        subtitle="Deja de generar tomas diarias y compras futuras, conservando el historial clinico."
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleArchiveSubmit} className="space-y-4">
          {archiveError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
            >
              {archiveError}
            </div>
          )}

          <div>
            <label
              htmlFor="archive-reason"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Motivo medico o administrativo (opcional)
            </label>
            <input
              id="archive-reason"
              type="text"
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="Ej. Tratamiento concluido por medico"
              className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setArchiveTarget(null)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingArchive}
              className="clinical-btn px-4 bg-[#D97706] hover:bg-[#B45309] text-white text-[14px] font-semibold"
            >
              {savingArchive ? "Archivando..." : "Confirmar Archivo"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Gestion de Bloques Horarios */}
      <ClinicalModal
        open={clustersModalOpen}
        onClose={() => !savingCluster && setClustersModalOpen(false)}
        title="Bloques Horarios de Toma"
        subtitle="Agrupa medicamentos en momentos clave del dia (ej. Desayuno 08:00, Vespertino 15:00, Cena 21:00)."
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-5">
          <div className="space-y-2.5">
            {snapshot.clusters.map((cluster) => {
              const isConfirmDel = confirmDeleteClusterId === cluster.id;
              return (
                <div
                  key={cluster.id}
                  className="p-3.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[14px] font-bold text-[#0E7490]">
                        {formatShortTime(cluster.anchor_time)}
                      </span>
                      <span className="font-bold text-[15px] text-[#0F172A]">
                        {cluster.label}
                      </span>
                      <StatusBadge
                        label={INTAKE_RULE_TAG[cluster.intake_rule]}
                        tone="neutral"
                      />
                      {!cluster.is_active && (
                        <StatusBadge label="[INACTIVO]" tone="warn" />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <IconActionButton
                      icon={Edit3}
                      label={`Editar bloque ${cluster.label}`}
                      tone="neutral"
                      onClick={() => startEditCluster(cluster)}
                    />
                    {isAdmin &&
                      (isConfirmDel ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busyKey === `del-cluster:${cluster.id}`}
                            onClick={async () => {
                              setBusyKey(`del-cluster:${cluster.id}`);
                              try {
                                await onDeleteCluster(cluster.id);
                                setConfirmDeleteClusterId(null);
                              } catch {
                                // Toast
                              } finally {
                                setBusyKey(null);
                              }
                            }}
                            className="clinical-btn px-2.5 bg-[#991B1B] text-white text-[12px] font-bold"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteClusterId(null)}
                            className="clinical-btn px-2 border border-[#CBD5E1] bg-white text-[#334155] text-[12px]"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <IconActionButton
                          icon={Trash2}
                          label={`Eliminar bloque ${cluster.label}`}
                          tone="danger"
                          onClick={() => setConfirmDeleteClusterId(cluster.id)}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={handleClusterSubmit}
            className="p-4 rounded-[6px] border border-[#E2E8F0] bg-white space-y-3"
          >
            <h4 className="text-[14px] font-bold text-[#0F172A]">
              {editingCluster
                ? `Editando bloque: ${editingCluster.label}`
                : "Agregar nuevo bloque horario"}
            </h4>

            {clusterError && (
              <div
                role="alert"
                className="p-2.5 rounded-[4px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
              >
                {clusterError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="cluster-label"
                  className="block text-[12px] font-semibold text-[#0F172A] mb-1"
                >
                  Nombre *
                </label>
                <input
                  id="cluster-label"
                  type="text"
                  required
                  value={clusterLabel}
                  onChange={(e) => setClusterLabel(e.target.value)}
                  placeholder="Ej. Bloque Vespertino"
                  className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
                />
              </div>

              <div>
                <label
                  htmlFor="cluster-anchor"
                  className="block text-[12px] font-semibold text-[#0F172A] mb-1"
                >
                  Hora ancla *
                </label>
                <input
                  id="cluster-anchor"
                  type="time"
                  required
                  value={clusterAnchor}
                  onChange={(e) => setClusterAnchor(e.target.value)}
                  className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
                />
              </div>

              <div>
                <label
                  htmlFor="cluster-rule"
                  className="block text-[12px] font-semibold text-[#0F172A] mb-1"
                >
                  Regla
                </label>
                <select
                  id="cluster-rule"
                  value={clusterRule}
                  onChange={(e) =>
                    setClusterRule(e.target.value as IntakeConstraint)
                  }
                  className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
                >
                  {(
                    [
                      "NONE",
                      "FASTING",
                      "WITH_FOOD",
                      "SEPARATE_FROM_OTHERS",
                    ] as IntakeConstraint[]
                  ).map((rule) => (
                    <option key={rule} value={rule}>
                      {INTAKE_RULE_LABEL[rule]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {editingCluster && (
              <label className="flex items-center gap-2 text-[13px] text-[#0F172A] cursor-pointer">
                <input
                  type="checkbox"
                  checked={clusterActive}
                  onChange={(e) => setClusterActive(e.target.checked)}
                  className="w-4 h-4 accent-[#0E7490]"
                />
                Bloque activo para agrupacion automatica
              </label>
            )}

            <div className="flex items-center justify-end gap-2">
              {editingCluster && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCluster(null);
                    setClusterLabel("");
                  }}
                  className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[13px]"
                >
                  Nuevo en su lugar
                </button>
              )}
              <button
                type="submit"
                disabled={savingCluster}
                className="clinical-btn px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[13px] font-semibold"
              >
                {savingCluster
                  ? "Guardando..."
                  : editingCluster
                  ? "Actualizar Bloque"
                  : "Crear Bloque"}
              </button>
            </div>
          </form>
        </div>
      </ClinicalModal>

      {/* Modal Control de Versiones (Solo Administrador) */}
      {isAdmin && (
        <MedicationVersionsModal
          medication={versionsTarget}
          versions={snapshot.medication_versions}
          onClose={() => setVersionsTarget(null)}
          onRestoreVersion={onRestoreVersion}
          onMarkReviewed={onMarkVersionReviewed}
        />
      )}
    </div>
  );
}
