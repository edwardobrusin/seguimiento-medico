"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Clock3,
  FileWarning,
  MessageSquarePlus,
  MessageSquareText,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Send,
  SkipForward,
  Trash2,
  Wallet,
} from "lucide-react";
import type {
  ClusterIntakeItem,
  CommandCenterSnapshot,
  IntakeStatus,
  TodayClusterBlock,
} from "@/lib/types/clinical";
import {
  EVENT_CATEGORY_TAG,
  INTAKE_RULE_TAG,
  INTAKE_STATUS_TAG,
  PRIORITY_TAG,
  TASK_STATUS_TAG,
} from "@/lib/clinical-labels";
import {
  cn,
  formatCurrencyMxn,
  formatDateTimeEs,
  formatShortTime,
  getDaysUntil,
  getLocalDateIso,
} from "@/lib/utils";
import { IconActionButton } from "./IconActionButton";
import { StatusBadge } from "./StatusBadge";

interface CommandCenterViewProps {
  snapshot: CommandCenterSnapshot;
  isAdmin: boolean;
  onSelectDate: (dateStr: string) => Promise<void>;
  onConfirmCluster: (clusterId: string, dateStr: string) => Promise<void>;
  onUpdateIntakeLog: (
    intakeLogId: string,
    status: IntakeStatus,
    observations?: string
  ) => Promise<void>;
  onDeleteIntakeLog: (intakeLogId: string) => Promise<void>;
  onRestockMedication: (
    medicationId: string,
    quantity: number,
    options?: {
      expense_amount?: number | null;
      provider_or_pharmacy?: string | null;
      log_expense?: boolean;
    }
  ) => Promise<void>;
  onGenerateTodayLogs: (dateStr?: string) => Promise<void>;
  onNavigateTab: (
    tab: "inventory" | "finances" | "events" | "topics" | "dossier"
  ) => void;
}

export function CommandCenterView({
  snapshot,
  isAdmin,
  onSelectDate,
  onConfirmCluster,
  onUpdateIntakeLog,
  onDeleteIntakeLog,
  onRestockMedication,
  onGenerateTodayLogs,
  onNavigateTab,
}: CommandCenterViewProps) {
  const [restockTargetId, setRestockTargetId] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState<string>("30");
  const [restockCost, setRestockCost] = useState<string>("");
  const [restockLogExpense, setRestockLogExpense] = useState(true);

  const [editingObsLogId, setEditingObsLogId] = useState<string | null>(null);
  const [obsText, setObsText] = useState("");
  const [confirmDeleteLogId, setConfirmDeleteLogId] = useState<string | null>(
    null
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const todayIso = getLocalDateIso();
  const yesterdayIso = getLocalDateIso(new Date(Date.now() - 86400000));

  const allItems = [
    ...snapshot.today_clusters.flatMap((c) => c.items),
    ...snapshot.unclustered_today_intakes,
  ];
  const pendingClustersCount = snapshot.today_clusters.filter(
    (c) => c.block_status === "PENDING" || c.block_status === "PARTIAL"
  ).length;
  const totalIntakesToday = allItems.length;
  const takenIntakesToday = allItems.filter((i) => i.status === "TAKEN").length;

  const nextBucket = snapshot.financial_plan.buckets[0] ?? null;

  async function handleClusterConfirm(block: TodayClusterBlock) {
    setBusyKey(`cluster:${block.cluster_id}`);
    try {
      await onConfirmCluster(block.cluster_id, snapshot.target_date);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSingleStatusChange(
    intakeLogId: string,
    status: IntakeStatus
  ) {
    setBusyKey(`intake:${intakeLogId}`);
    try {
      await onUpdateIntakeLog(intakeLogId, status);
    } catch {
      // El toast global en ClinicalShell muestra el error
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRestockSubmit(medId: string) {
    const qty = Number(restockQty);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const parsedCost =
      restockCost.trim() !== "" && Number.isFinite(Number(restockCost))
        ? Number(restockCost)
        : null;
    setBusyKey(`restock:${medId}`);
    try {
      await onRestockMedication(medId, qty, {
        expense_amount: parsedCost,
        log_expense: restockLogExpense && parsedCost !== null,
      });
      setRestockTargetId(null);
      setRestockCost("");
    } catch {
      // El toast global muestra el error
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveObservation(item: ClusterIntakeItem) {
    setBusyKey(`obs:${item.intake_log_id}`);
    try {
      await onUpdateIntakeLog(item.intake_log_id, item.status, obsText.trim());
      setEditingObsLogId(null);
      setObsText("");
    } catch {
      // Toast global muestra el error
    } finally {
      setBusyKey(null);
    }
  }

  function renderIntakeRow(item: ClusterIntakeItem) {
    const isEditingObs = editingObsLogId === item.intake_log_id;
    const isConfirmDelete = confirmDeleteLogId === item.intake_log_id;
    const isRowBusy = busyKey === `intake:${item.intake_log_id}`;
    const hasObs = Boolean(item.observations?.trim());

    return (
      <tr key={item.intake_log_id} className="bg-white hover:bg-[#F8FAFC]">
        <td className="py-3 px-4 align-top">
          <div className="font-bold text-[15px] text-[#0F172A]">
            {item.medication_name}
          </div>
          {item.active_ingredient && (
            <div className="text-[13px] text-[#475569]">
              {item.active_ingredient}
            </div>
          )}
          {hasObs && !isEditingObs && (
            <p className="mt-1 text-[13px] text-[#164E63] bg-[#ECFEFF] border border-[#A5F3FC] rounded-[4px] px-2 py-0.5 inline-block">
              Nota: {item.observations}
            </p>
          )}
          {isEditingObs && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Motivo u observacion clinica"
                aria-label={`Observacion para ${item.medication_name}`}
                value={obsText}
                onChange={(e) => setObsText(e.target.value)}
                className="h-[42px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px] min-w-[200px] bg-white"
              />
              <button
                type="button"
                disabled={busyKey === `obs:${item.intake_log_id}`}
                onClick={() => handleSaveObservation(item)}
                className="clinical-btn px-3 bg-[#0E7490] text-white text-[13px] font-semibold"
              >
                {busyKey === `obs:${item.intake_log_id}`
                  ? "Guardando..."
                  : "Guardar"}
              </button>
              <button
                type="button"
                onClick={() => setEditingObsLogId(null)}
                className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[13px]"
              >
                Cancelar
              </button>
            </div>
          )}
        </td>
        <td className="py-3 px-3 align-top font-mono text-[14px] tabular-nums text-[#0F172A]">
          {item.quantity_deducted} {item.presentation}
        </td>
        <td className="py-3 px-3 align-top">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[13px] text-[#334155]">
              {INTAKE_RULE_TAG[item.intake_rule]}
            </span>
            {item.ideal_time && item.effective_clustered_time && (
              <span className="font-mono text-[13px] text-[#64748B] tabular-nums">
                Ideal {formatShortTime(item.ideal_time)} -&gt;{" "}
                {formatShortTime(item.effective_clustered_time)}
              </span>
            )}
          </div>
        </td>
        <td className="py-3 px-3 align-top font-mono text-[13px] tabular-nums">
          {item.current_stock === null ? (
            <span className="text-[#92400E] font-semibold">[PENDIENTE]</span>
          ) : (
            <span
              className={cn(
                "font-semibold",
                item.days_of_supply_remaining !== null &&
                  item.days_of_supply_remaining <= 7
                  ? "text-[#991B1B]"
                  : "text-[#0F172A]"
              )}
            >
              {item.current_stock} (
              {item.days_of_supply_remaining === null
                ? "--"
                : `${item.days_of_supply_remaining}d`}
              )
            </span>
          )}
        </td>
        <td className="py-3 px-4 align-top text-right">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge
              label={INTAKE_STATUS_TAG[item.status]}
              tone={
                item.status === "TAKEN"
                  ? "ok"
                  : item.status === "PENDING"
                  ? "warn"
                  : "neutral"
              }
            />

            {item.status === "PENDING" ? (
              <>
                <IconActionButton
                  icon={Check}
                  label={`Marcar ${item.medication_name} como tomado`}
                  tone="primary"
                  loading={isRowBusy}
                  onClick={() =>
                    handleSingleStatusChange(item.intake_log_id, "TAKEN")
                  }
                />
                <IconActionButton
                  icon={Clock3}
                  label={`Posponer ${item.medication_name}`}
                  tone="warn"
                  loading={isRowBusy}
                  onClick={() =>
                    handleSingleStatusChange(item.intake_log_id, "DELAYED")
                  }
                />
                <IconActionButton
                  icon={SkipForward}
                  label={`Omitir ${item.medication_name}`}
                  tone="neutral"
                  loading={isRowBusy}
                  onClick={() =>
                    handleSingleStatusChange(item.intake_log_id, "SKIPPED")
                  }
                />
              </>
            ) : (
              <IconActionButton
                icon={RotateCcw}
                label={`Revertir ${item.medication_name} a pendiente (reembolsa stock)`}
                tone="info"
                loading={isRowBusy}
                onClick={() =>
                  handleSingleStatusChange(item.intake_log_id, "PENDING")
                }
              />
            )}

            <IconActionButton
              icon={hasObs ? MessageSquareText : MessageSquarePlus}
              label={
                hasObs
                  ? `Editar nota clinica (${item.medication_name})`
                  : `Agregar nota clinica (${item.medication_name})`
              }
              tone="neutral"
              active={isEditingObs || hasObs}
              onClick={() => {
                setEditingObsLogId(isEditingObs ? null : item.intake_log_id);
                setObsText(item.observations ?? "");
              }}
            />

            {isAdmin &&
              (isConfirmDelete ? (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busyKey === `del:${item.intake_log_id}`}
                    onClick={async () => {
                      setBusyKey(`del:${item.intake_log_id}`);
                      try {
                        await onDeleteIntakeLog(item.intake_log_id);
                        setConfirmDeleteLogId(null);
                      } catch {
                        // Toast global muestra error
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
                    onClick={() => setConfirmDeleteLogId(null)}
                    className="clinical-btn px-2 border border-[#CBD5E1] bg-white text-[#334155] text-[12px]"
                  >
                    No
                  </button>
                </div>
              ) : (
                <IconActionButton
                  icon={Trash2}
                  label={`Eliminar registro de toma ${item.medication_name}`}
                  tone="danger"
                  onClick={() => setConfirmDeleteLogId(item.intake_log_id)}
                />
              ))}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-6 clinical-enter">
      {/* KPIs Clinicos y Financieros del Dia */}
      <section
        aria-label="Indicadores clinicos del dia"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"
      >
        <div className="clinical-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#475569]">
              Tomas de hoy ({snapshot.target_date})
            </span>
            <CheckCircle2
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[26px] font-bold leading-none tabular-nums text-[#0F172A]">
            {takenIntakesToday}/{totalIntakesToday}
          </p>
          <p className="mt-1.5 text-[13px] text-[#475569] tabular-nums">
            {pendingClustersCount} bloques pendientes
          </p>
        </div>

        <div
          className={cn(
            "clinical-card p-4",
            snapshot.low_stock_medications.length > 0 &&
              "border-[#FECACA] bg-[#FEF2F2]"
          )}
        >
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "text-[13px] font-medium",
                snapshot.low_stock_medications.length > 0
                  ? "text-[#991B1B]"
                  : "text-[#475569]"
              )}
            >
              Restock critico (&lt;= 7d)
            </span>
            <AlertTriangle
              className={cn(
                "w-4 h-4",
                snapshot.low_stock_medications.length > 0
                  ? "text-[#991B1B]"
                  : "text-[#065F46]"
              )}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p
            className={cn(
              "mt-2 font-mono text-[26px] font-bold leading-none tabular-nums",
              snapshot.low_stock_medications.length > 0
                ? "text-[#991B1B]"
                : "text-[#0F172A]"
            )}
          >
            {snapshot.low_stock_medications.length}
          </p>
          <p
            className={cn(
              "mt-1.5 text-[13px]",
              snapshot.low_stock_medications.length > 0
                ? "text-[#991B1B]"
                : "text-[#475569]"
            )}
          >
            {snapshot.low_stock_medications.length > 0
              ? "Reabastecimiento requerido"
              : "Cobertura estable"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigateTab("finances")}
          className="clinical-card p-4 text-left hover:border-[#0E7490] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#475569]">
              Proxima Quincena
            </span>
            <Wallet
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[24px] font-bold leading-none tabular-nums text-[#0F172A]">
            {nextBucket
              ? formatCurrencyMxn(nextBucket.total_cost)
              : "$0.00"}
          </p>
          <p className="mt-1.5 text-[13px] text-[#0E7490] truncate">
            {nextBucket
              ? `${nextBucket.pay_date} (${nextBucket.purchases.length} comp.)`
              : "Sin compras planeadas"}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab("events")}
          className="clinical-card p-4 text-left hover:border-[#0E7490] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#475569]">
              Eventos clinicos activos
            </span>
            <CalendarClock
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[26px] font-bold leading-none tabular-nums text-[#0F172A]">
            {snapshot.upcoming_events.length}
          </p>
          <p className="mt-1.5 text-[13px] text-[#475569]">
            Citas, estudios e inyecciones
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab("topics")}
          className="clinical-card p-4 text-left hover:border-[#0E7490] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#475569]">
              Temas de seguimiento
            </span>
            <ClipboardList
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[26px] font-bold leading-none tabular-nums text-[#0F172A]">
            {snapshot.open_topics.length}
          </p>
          <p className="mt-1.5 text-[13px] text-[#475569]">
            Pendientes con bitacora
          </p>
        </button>
      </section>

      {/* Banda de Datos Pendientes (Medicamentos diferibles como Rolet Sup) */}
      {snapshot.incomplete_medications.length > 0 && (
        <section
          aria-labelledby="incomplete-meds-heading"
          className="border border-[#FDE68A] bg-[#FFFBEB] rounded-[6px] p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <FileWarning
              className="w-5 h-5 text-[#92400E] shrink-0 mt-0.5"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div>
              <h2
                id="incomplete-meds-heading"
                className="text-[15px] font-bold text-[#92400E]"
              >
                [DATOS PENDIENTES]{" "}
                {snapshot.incomplete_medications.length} medicamento(s) requieren
                precio, piezas por envase o inventario inicial
              </h2>
              <p className="text-[14px] text-[#78350F]">
                Pendientes:{" "}
                {snapshot.incomplete_medications.map((m) => m.name).join(", ")}.
                Sus tomas diarias funcionan con normalidad y podras integrarlos al
                plan quincenal al completar estos datos.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab("inventory")}
            className="clinical-btn px-3.5 bg-white border border-[#F59E0B] text-[#92400E] hover:bg-[#FEF3C7] text-[14px] font-bold"
          >
            Completar en Medicamentos
          </button>
        </section>
      )}

      {/* Banda de Alerta de Restock Critico (<= 7 dias) */}
      {snapshot.low_stock_medications.length > 0 && (
        <section
          aria-labelledby="critical-restock-heading"
          className="border border-[#FECACA] bg-[#FEF2F2] rounded-[6px] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#FECACA] pb-3">
            <div className="flex items-center gap-2.5">
              <AlertTriangle
                className="w-5 h-5 text-[#991B1B] shrink-0"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <div>
                <h2
                  id="critical-restock-heading"
                  className="text-[16px] font-bold text-[#991B1B]"
                >
                  [ALERTA DE RESTOCK CRITICO] Cobertura igual o menor a 7 dias
                </h2>
                <p className="text-[14px] text-[#7F1D1D]">
                  Medicamentos con menos de una semana de autonomia restante.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("inventory")}
              className="clinical-btn px-3 py-2 text-[14px] font-medium border border-[#FCA5A5] bg-white text-[#991B1B] hover:bg-[#FEE2E2]"
            >
              Ver inventario completo
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {snapshot.low_stock_medications.map((med) => {
              const isEditing = restockTargetId === med.id;
              return (
                <div
                  key={med.id}
                  className="bg-white border border-[#FECACA] rounded-[6px] p-3 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[15px] text-[#0F172A]">
                          {med.name}
                        </span>
                        <StatusBadge label="[CRITICO]" tone="crit" />
                      </div>
                      <p className="mt-1 text-[13px] text-[#475569] font-mono tabular-nums">
                        Stock actual: {med.current_stock ?? 0} {med.presentation}
                        (s) | Tasa diaria: {med.daily_consumption_rate}/dia
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block font-mono text-[20px] font-bold tabular-nums text-[#991B1B]">
                        {med.days_of_supply_remaining ?? 0} d
                      </span>
                      <span className="text-[13px] text-[#991B1B]">
                        restantes
                      </span>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 pt-2 border-t border-[#F1F5F9]">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label
                            htmlFor={`cmd-restock-${med.id}`}
                            className="block text-[12px] font-medium text-[#334155] mb-1"
                          >
                            Unidades ({med.presentation})
                          </label>
                          <input
                            id={`cmd-restock-${med.id}`}
                            type="number"
                            min="0.01"
                            step="any"
                            value={restockQty}
                            onChange={(e) => setRestockQty(e.target.value)}
                            className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] tabular-nums bg-white"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`cmd-cost-${med.id}`}
                            className="block text-[12px] font-medium text-[#334155] mb-1"
                          >
                            Costo pagado (MXN opc.)
                          </label>
                          <input
                            id={`cmd-cost-${med.id}`}
                            type="number"
                            min="0"
                            step="any"
                            placeholder={
                              med.package_price !== null
                                ? String(med.package_price)
                                : "0.00"
                            }
                            value={restockCost}
                            onChange={(e) => setRestockCost(e.target.value)}
                            className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] tabular-nums bg-white"
                          />
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-[13px] text-[#334155] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={restockLogExpense}
                          onChange={(e) => setRestockLogExpense(e.target.checked)}
                          className="w-4 h-4 accent-[#0E7490]"
                        />
                        Registrar compra en Bitacora de Gastos
                      </label>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setRestockTargetId(null)}
                          className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={busyKey === `restock:${med.id}`}
                          onClick={() => handleRestockSubmit(med.id)}
                          className="clinical-btn px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-medium"
                        >
                          Guardar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end">
                      <IconActionButton
                        icon={PackagePlus}
                        shortLabel="Restock"
                        label={`Registrar restock de ${med.name}`}
                        tone="danger"
                        onClick={() => {
                          setRestockTargetId(med.id);
                          setRestockQty(String(med.units_per_package ?? 30));
                          setRestockCost(
                            med.package_price !== null
                              ? String(med.package_price)
                              : ""
                          );
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Cuerpo Principal: Bloques Horarios del Dia + Resumen Lateral */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section
          aria-labelledby="clusters-heading"
          className="lg:col-span-8 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                id="clusters-heading"
                className="text-[20px] font-bold text-[#0F172A]"
              >
                Bloques Horarios de Medicacion ({snapshot.target_date})
              </h2>
              <p className="text-[14px] text-[#475569]">
                Control rapido por simbolos para confirmar, posponer o anotar cada toma.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSelectDate(yesterdayIso)}
                className={cn(
                  "clinical-btn px-3 text-[13px] font-medium border",
                  snapshot.target_date === yesterdayIso
                    ? "bg-[#0E7490] border-[#0E7490] text-white"
                    : "bg-white border-[#CBD5E1] text-[#334155]"
                )}
              >
                Ayer
              </button>
              <button
                type="button"
                onClick={() => onSelectDate(todayIso)}
                className={cn(
                  "clinical-btn px-3 text-[13px] font-medium border",
                  snapshot.target_date === todayIso
                    ? "bg-[#0E7490] border-[#0E7490] text-white"
                    : "bg-white border-[#CBD5E1] text-[#334155]"
                )}
              >
                Hoy
              </button>
              <label htmlFor="cmd-date-picker" className="sr-only">
                Seleccionar fecha operativa
              </label>
              <input
                id="cmd-date-picker"
                type="date"
                value={snapshot.target_date}
                onChange={(e) => {
                  if (e.target.value) onSelectDate(e.target.value);
                }}
                className="h-[44px] px-2.5 border border-[#CBD5E1] rounded-[6px] font-mono text-[13px] bg-white"
              />
            </div>
          </div>

          {/* Leyenda de simbolos accesible en movil y escritorio */}
          <div
            aria-label="Guia de simbolos de control de toma"
            className="clinical-card px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[#334155] bg-white"
          >
            <span className="font-semibold text-[#0F172A]">Simbolos:</span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-[#0E7490]" strokeWidth={2} aria-hidden="true" />
              Tomado
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="w-3.5 h-3.5 text-[#92400E]" strokeWidth={2} aria-hidden="true" />
              Posponer
            </span>
            <span className="inline-flex items-center gap-1.5">
              <SkipForward className="w-3.5 h-3.5 text-[#475569]" strokeWidth={2} aria-hidden="true" />
              Omitir
            </span>
            <span className="inline-flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5 text-[#164E63]" strokeWidth={2} aria-hidden="true" />
              Revertir
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MessageSquarePlus className="w-3.5 h-3.5 text-[#334155]" strokeWidth={2} aria-hidden="true" />
              Nota
            </span>
            {isAdmin && (
              <span className="inline-flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5 text-[#991B1B]" strokeWidth={2} aria-hidden="true" />
                Eliminar
              </span>
            )}
          </div>

          {snapshot.resting_medications_today.length > 0 && (
            <div className="px-4 py-2.5 rounded-[6px] border border-[#CBD5E1] bg-[#F1F5F9] text-[13px] text-[#334155] flex flex-wrap items-center gap-2">
              <span className="font-bold text-[#0F172A]">
                Sin toma programada para {snapshot.target_date}:
              </span>
              {snapshot.resting_medications_today.map((rm) => (
                <StatusBadge
                  key={rm.medication_id}
                  label={`${rm.name} (${rm.active_days_label})`}
                  tone="neutral"
                />
              ))}
            </div>
          )}

          {snapshot.today_clusters.length === 0 &&
          snapshot.unclustered_today_intakes.length === 0 ? (
            <div className="clinical-card p-6 text-center space-y-3 text-[#475569]">
              <p>No hay tomas registradas para {snapshot.target_date}.</p>
              <button
                type="button"
                onClick={() => onGenerateTodayLogs(snapshot.target_date)}
                className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
              >
                <RefreshCw className="w-4 h-4" strokeWidth={1.85} aria-hidden="true" />
                Generar tomas para {snapshot.target_date}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {snapshot.today_clusters.map((block) => {
                const isTaken = block.block_status === "TAKEN";
                const isConfirming = busyKey === `cluster:${block.cluster_id}`;
                const tg = isAdmin ? block.telegram_notification : null;

                return (
                  <article
                    key={block.cluster_id}
                    className={cn(
                      "clinical-card overflow-hidden",
                      isTaken && "border-[#A7F3D0]"
                    )}
                  >
                    <header
                      className={cn(
                        "px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3",
                        isTaken
                          ? "bg-[#ECFDF5] border-[#A7F3D0]"
                          : "bg-[#F8FAFC] border-[#E2E8F0]"
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="inline-flex items-center gap-1.5 font-mono text-[16px] font-bold tabular-nums text-[#0F172A]">
                          <Clock
                            className="w-4 h-4 text-[#0E7490]"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          {formatShortTime(block.anchor_time)}
                        </span>
                        <h3 className="text-[16px] font-bold text-[#0F172A]">
                          {block.label}
                        </h3>
                        <StatusBadge
                          label={INTAKE_RULE_TAG[block.intake_rule]}
                          tone="info"
                        />
                        <StatusBadge
                          label={
                            block.block_status === "TAKEN"
                              ? "[BLOQUE CONFIRMADO]"
                              : block.block_status === "PARTIAL"
                              ? "[PARCIAL]"
                              : block.block_status === "DELAYED"
                              ? "[POSPUESTO]"
                              : block.block_status === "SKIPPED"
                              ? "[OMITIDO]"
                              : "[PENDIENTE]"
                          }
                          tone={
                            block.block_status === "TAKEN"
                              ? "ok"
                              : block.block_status === "PENDING" ||
                                block.block_status === "PARTIAL"
                              ? "warn"
                              : "neutral"
                          }
                        />
                      </div>

                      {isAdmin && tg && (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-[#334155]">
                            <Send
                              className="w-3.5 h-3.5 text-[#0E7490]"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                            {tg.status === "ACKNOWLEDGED"
                              ? "[TELEGRAM CONFIRMADO]"
                              : tg.status === "SENT"
                              ? "[TELEGRAM ENVIADO]"
                              : "[TELEGRAM EN COLA]"}
                          </span>
                        </div>
                      )}
                    </header>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#E2E8F0] text-[13px] font-medium text-[#475569] bg-white">
                            <th className="py-2.5 px-4">Medicamento</th>
                            <th className="py-2.5 px-3">Dosis</th>
                            <th className="py-2.5 px-3">Regla / Horario</th>
                            <th className="py-2.5 px-3">Stock Restante</th>
                            <th className="py-2.5 px-4 text-right">
                              Estado y Control
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0]">
                          {block.items.map(renderIntakeRow)}
                        </tbody>
                      </table>
                    </div>

                    <footer className="px-4 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[13px] font-mono text-[#475569] tabular-nums">
                        {isTaken && block.items[0]?.taken_at
                          ? `Confirmado: ${formatDateTimeEs(
                              block.items[0].taken_at
                            )} | Registro: ${
                              block.items[0].recorded_by ?? "Sistema"
                            }`
                          : "Al confirmar se descuenta inventario atomicamente (si el stock esta capturado)."}
                      </div>

                      {block.items.some((i) => i.status === "PENDING") && (
                        <button
                          type="button"
                          disabled={isConfirming}
                          onClick={() => handleClusterConfirm(block)}
                          className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[15px] font-bold"
                        >
                          <CheckCircle2
                            className="w-4 h-4"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          {isConfirming
                            ? "Registrando..."
                            : "Confirmar Bloque Tomado"}
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}

              {snapshot.unclustered_today_intakes.length > 0 && (
                <article className="clinical-card overflow-hidden">
                  <header className="px-4 py-3 border-b bg-[#F8FAFC] border-[#E2E8F0] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock
                        className="w-4 h-4 text-[#0E7490]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <h3 className="text-[16px] font-bold text-[#0F172A]">
                        Tomas en Horario Dedicado (Sin Bloque Compartido)
                      </h3>
                    </div>
                    <StatusBadge
                      label={`${snapshot.unclustered_today_intakes.length} TOMA(S)`}
                      tone="info"
                    />
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] text-[13px] font-medium text-[#475569] bg-white">
                          <th className="py-2.5 px-4">Medicamento</th>
                          <th className="py-2.5 px-3">Dosis</th>
                          <th className="py-2.5 px-3">Regla / Horario</th>
                          <th className="py-2.5 px-3">Stock Restante</th>
                          <th className="py-2.5 px-4 text-right">
                            Estado y Control
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0]">
                        {snapshot.unclustered_today_intakes.map(renderIntakeRow)}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}
            </div>
          )}
        </section>

        {/* Columna Derecha (4 cols): Proxima Quincena + Agenda + Temas */}
        <aside className="lg:col-span-4 space-y-4">
          {nextBucket && (
            <div className="clinical-card p-4 space-y-3 border-[#A5F3FC]">
              <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
                <h2 className="text-[16px] font-bold text-[#0F172A]">
                  Proxima Quincena de Compras
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab("finances")}
                  className="text-[13px] font-medium text-[#0E7490] hover:underline"
                >
                  Plan Quincenal
                </button>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-[14px] font-bold text-[#0F172A]">
                    {nextBucket.label}
                  </p>
                  <p className="font-mono text-[12px] text-[#64748B]">
                    Ventana: {nextBucket.pay_date} a {nextBucket.period_end}
                  </p>
                </div>
                <span className="font-mono text-[20px] font-bold text-[#0E7490] tabular-nums">
                  {formatCurrencyMxn(nextBucket.total_cost)}
                </span>
              </div>
              {nextBucket.purchases.length === 0 && nextBucket.events.length === 0 ? (
                <p className="text-[13px] text-[#475569]">
                  Sin compras ni consultas programadas en esta quincena.
                </p>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {nextBucket.purchases.map((p) => (
                    <li
                      key={p.plan_item_id}
                      className="flex items-center justify-between gap-2 py-1 border-b border-[#F1F5F9]"
                    >
                      <span className="text-[#0F172A] truncate">
                        {p.medication_name} ({p.packages}x)
                      </span>
                      <span className="font-mono font-semibold text-[#0F172A] tabular-nums shrink-0">
                        {formatCurrencyMxn(p.total_cost)}
                      </span>
                    </li>
                  ))}
                  {nextBucket.events.map((ev) => (
                    <li
                      key={ev.event_id}
                      className="flex items-center justify-between gap-2 py-1 border-b border-[#F1F5F9]"
                    >
                      <span className="text-[#164E63] truncate">
                        [EVENTO] {ev.title}
                      </span>
                      <span className="font-mono font-semibold text-[#164E63] tabular-nums shrink-0">
                        {formatCurrencyMxn(ev.estimated_cost)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="clinical-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
              <h2 className="text-[16px] font-bold text-[#0F172A]">
                Proximos Eventos Clinicos
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab("events")}
                className="text-[13px] font-medium text-[#0E7490] hover:underline"
              >
                Abrir Agenda
              </button>
            </div>

            {snapshot.upcoming_events.length === 0 ? (
              <p className="text-[14px] text-[#475569]">
                Sin eventos pendientes.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {snapshot.upcoming_events.slice(0, 4).map((evt) => {
                  const daysLeft = getDaysUntil(evt.event_datetime);
                  return (
                    <li
                      key={evt.id}
                      className="border border-[#E2E8F0] rounded-[6px] p-3 bg-[#F8FAFC]"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <StatusBadge
                          label={EVENT_CATEGORY_TAG[evt.category]}
                          tone="info"
                        />
                        <span className="font-mono text-[13px] font-semibold tabular-nums text-[#334155]">
                          {daysLeft <= 0
                            ? "[HOY]"
                            : `En ${daysLeft} dia(s)`}
                        </span>
                      </div>
                      <p className="mt-1.5 font-bold text-[14px] text-[#0F172A]">
                        {evt.title}
                      </p>
                      <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[13px] text-[#475569] tabular-nums">
                        <span>{formatDateTimeEs(evt.event_datetime)}</span>
                        {evt.estimated_cost !== null && evt.estimated_cost > 0 && (
                          <span className="font-semibold text-[#0F172A]">
                            {formatCurrencyMxn(evt.estimated_cost)}
                          </span>
                        )}
                      </div>
                      {evt.is_recurring && (
                        <p className="mt-1 font-mono text-[12px] text-[#0E7490]">
                          [CICLO {evt.periodicity_label ?? `CADA ${evt.recurrence_interval_days} DIAS`}]
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="clinical-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
              <h2 className="text-[16px] font-bold text-[#0F172A]">
                Temas de Seguimiento Abiertos
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab("topics")}
                className="text-[13px] font-medium text-[#0E7490] hover:underline"
              >
                Abrir Bitacora
              </button>
            </div>

            {snapshot.open_topics.length === 0 ? (
              <p className="text-[14px] text-[#475569]">
                No hay casos pendientes.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {snapshot.open_topics.slice(0, 4).map((topic) => (
                  <li
                    key={topic.id}
                    className="border border-[#E2E8F0] rounded-[6px] p-3 bg-[#F8FAFC]"
                  >
                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                      <StatusBadge
                        label={PRIORITY_TAG[topic.priority] ?? "[NORMAL]"}
                        tone={topic.priority === 1 ? "crit" : "warn"}
                      />
                      <StatusBadge
                        label={TASK_STATUS_TAG[topic.status]}
                        tone="neutral"
                      />
                    </div>
                    <p className="mt-1.5 font-bold text-[14px] text-[#0F172A]">
                      {topic.title}
                    </p>
                    <div className="mt-2 flex items-center justify-between font-mono text-[13px] text-[#475569] tabular-nums">
                      <span>Limite: {formatDateTimeEs(topic.deadline_at)}</span>
                      <span>{topic.progress_percentage}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0E7490]"
                        style={{ width: `${topic.progress_percentage}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
