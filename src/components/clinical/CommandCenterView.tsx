"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  PackagePlus,
  Send,
} from "lucide-react";
import type {
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
import { cn, formatDateTimeEs, formatShortTime, getDaysUntil } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

interface CommandCenterViewProps {
  snapshot: CommandCenterSnapshot;
  onConfirmCluster: (clusterId: string, dateStr: string) => Promise<void>;
  onUpdateIntakeLog: (
    intakeLogId: string,
    status: IntakeStatus
  ) => Promise<void>;
  onRestockMedication: (medicationId: string, quantity: number) => Promise<void>;
  onNavigateTab: (tab: "inventory" | "events" | "topics" | "telegram") => void;
}

export function CommandCenterView({
  snapshot,
  onConfirmCluster,
  onUpdateIntakeLog,
  onRestockMedication,
  onNavigateTab,
}: CommandCenterViewProps) {
  const [restockTargetId, setRestockTargetId] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState<string>("30");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const pendingClustersCount = snapshot.today_clusters.filter(
    (c) => c.block_status === "PENDING" || c.block_status === "PARTIAL"
  ).length;
  const totalIntakesToday = snapshot.today_clusters.reduce(
    (acc, c) => acc + c.items.length,
    0
  );
  const takenIntakesToday = snapshot.today_clusters.reduce(
    (acc, c) => acc + c.items.filter((i) => i.status === "TAKEN").length,
    0
  );

  async function handleClusterConfirm(block: TodayClusterBlock) {
    setBusyKey(`cluster:${block.cluster_id}`);
    try {
      await onConfirmCluster(block.cluster_id, snapshot.target_date);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRestockSubmit(medId: string) {
    const qty = Number(restockQty);
    if (!Number.isFinite(qty) || qty <= 0) return;
    setBusyKey(`restock:${medId}`);
    try {
      await onRestockMedication(medId, qty);
      setRestockTargetId(null);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6 clinical-enter">
      {/* KPIs Clinicos del Dia */}
      <section
        aria-label="Indicadores clinicos del dia"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="clinical-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#475569]">
              Adherencia del dia
            </span>
            <CheckCircle2
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 font-mono text-[28px] font-bold leading-none tabular-nums text-[#0F172A]">
            {takenIntakesToday}/{totalIntakesToday}
          </p>
          <p className="mt-1.5 text-[13px] text-[#475569] tabular-nums">
            {pendingClustersCount} bloques pendientes hoy
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
              Alertas de restock (&lt;= 7 dias)
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
              "mt-2 font-mono text-[28px] font-bold leading-none tabular-nums",
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
              : "Cobertura farmacologica estable"}
          </p>
        </div>

        <div className="clinical-card p-4">
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
          <p className="mt-2 font-mono text-[28px] font-bold leading-none tabular-nums text-[#0F172A]">
            {snapshot.upcoming_events.length}
          </p>
          <p className="mt-1.5 text-[13px] text-[#475569]">
            Citas e inyecciones programadas
          </p>
        </div>

        <div className="clinical-card p-4">
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
          <p className="mt-2 font-mono text-[28px] font-bold leading-none tabular-nums text-[#0F172A]">
            {snapshot.open_topics.length}
          </p>
          <p className="mt-1.5 text-[13px] text-[#475569]">
            Casos abiertos con bitacora
          </p>
        </div>
      </section>

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
                  El umbral automatico en PostgreSQL detecto farmacos con menos
                  de una semana de autonomia.
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
                        Stock actual: {med.current_stock} {med.presentation}(s)
                        | Tasa diaria: {med.daily_consumption_rate}/dia
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block font-mono text-[20px] font-bold tabular-nums text-[#991B1B]">
                        {med.days_of_supply_remaining} d
                      </span>
                      <span className="text-[13px] text-[#991B1B]">
                        restantes
                      </span>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="flex items-end gap-2 pt-2 border-t border-[#F1F5F9]">
                      <div className="flex-1">
                        <label
                          htmlFor={`cmd-restock-${med.id}`}
                          className="block text-[13px] font-medium text-[#334155] mb-1"
                        >
                          Unidades a sumar ({med.presentation})
                        </label>
                        <input
                          id={`cmd-restock-${med.id}`}
                          type="number"
                          min="1"
                          step="1"
                          value={restockQty}
                          onChange={(e) => setRestockQty(e.target.value)}
                          className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums bg-white"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={busyKey === `restock:${med.id}`}
                        onClick={() => handleRestockSubmit(med.id)}
                        className="clinical-btn px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-medium"
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setRestockTargetId(null)}
                        className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setRestockTargetId(med.id);
                          setRestockQty(String(med.units_per_package ?? 30));
                        }}
                        className="clinical-btn inline-flex items-center gap-2 px-3 bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-[14px] font-medium"
                      >
                        <PackagePlus
                          className="w-4 h-4"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                        Registrar Restock
                      </button>
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
        {/* Columna Izquierda (8 cols): Bloques Horarios Optimizados */}
        <section
          aria-labelledby="clusters-heading"
          className="lg:col-span-8 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2
                id="clusters-heading"
                className="text-[20px] font-bold text-[#0F172A]"
              >
                Bloques Horarios de Medicacion ({snapshot.target_date})
              </h2>
              <p className="text-[14px] text-[#475569]">
                Tomas agrupadas por tolerancia horaria y restriccion clinica
                para adherencia del 100%.
              </p>
            </div>
          </div>

          {snapshot.today_clusters.length === 0 ? (
            <div className="clinical-card p-6 text-center text-[#475569]">
              No hay tomas programadas para el dia de hoy. Registra un
              medicamento en Inventario para generar bloques automaticos.
            </div>
          ) : (
            <div className="space-y-4">
              {snapshot.today_clusters.map((block) => {
                const isTaken = block.block_status === "TAKEN";
                const isConfirming = busyKey === `cluster:${block.cluster_id}`;
                const tg = block.telegram_notification;

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
                              : "[PENDIENTE]"
                          }
                          tone={
                            block.block_status === "TAKEN" ? "ok" : "warn"
                          }
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        {tg && (
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
                        )}
                      </div>
                    </header>

                    {/* Tabla de medicamentos del bloque */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#E2E8F0] text-[13px] font-medium text-[#475569] bg-white">
                            <th className="py-2.5 px-4">Medicamento</th>
                            <th className="py-2.5 px-3">Dosis</th>
                            <th className="py-2.5 px-3">Regla / Horario</th>
                            <th className="py-2.5 px-3">Stock Restante</th>
                            <th className="py-2.5 px-4 text-right">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0]">
                          {block.items.map((item) => (
                            <tr
                              key={item.intake_log_id}
                              className="bg-white hover:bg-[#F8FAFC]"
                            >
                              <td className="py-3 px-4">
                                <div className="font-bold text-[15px] text-[#0F172A]">
                                  {item.medication_name}
                                </div>
                                {item.active_ingredient && (
                                  <div className="text-[13px] text-[#475569]">
                                    {item.active_ingredient}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3 font-mono text-[14px] tabular-nums text-[#0F172A]">
                                {item.quantity_deducted} {item.presentation}
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex flex-col gap-1">
                                  <span className="font-mono text-[13px] text-[#334155]">
                                    {INTAKE_RULE_TAG[item.intake_rule]}
                                  </span>
                                  {item.ideal_time &&
                                    item.effective_clustered_time && (
                                      <span className="font-mono text-[13px] text-[#64748B] tabular-nums">
                                        Ideal {formatShortTime(item.ideal_time)}{" "}
                                        -&gt;{" "}
                                        {formatShortTime(
                                          item.effective_clustered_time
                                        )}
                                      </span>
                                    )}
                                </div>
                              </td>
                              <td className="py-3 px-3 font-mono text-[13px] tabular-nums">
                                <span
                                  className={cn(
                                    "font-semibold",
                                    item.days_of_supply_remaining <= 7
                                      ? "text-[#991B1B]"
                                      : "text-[#0F172A]"
                                  )}
                                >
                                  {item.current_stock} ({item.days_of_supply_remaining}d)
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="inline-flex items-center justify-end gap-2">
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
                                  {item.status === "PENDING" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdateIntakeLog(
                                          item.intake_log_id,
                                          "TAKEN"
                                        )
                                      }
                                      className="clinical-btn px-2.5 text-[13px] font-medium border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A]"
                                      aria-label={`Marcar ${item.medication_name} como tomado`}
                                    >
                                      Tomado
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pie de accion del bloque */}
                    <footer className="px-4 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[13px] font-mono text-[#475569] tabular-nums">
                        {isTaken && block.items[0]?.taken_at
                          ? `Confirmado: ${formatDateTimeEs(
                              block.items[0].taken_at
                            )} | Registro: ${
                              block.items[0].recorded_by ?? "Sistema"
                            }`
                          : "Al confirmar se descuenta inventario atomicamente en PostgreSQL."}
                      </div>

                      {!isTaken && (
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
            </div>
          )}
        </section>

        {/* Columna Derecha (4 cols): Agenda Proxima + Casos Urgentes */}
        <aside className="lg:col-span-4 space-y-4">
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
                      <p className="mt-0.5 font-mono text-[13px] text-[#475569] tabular-nums">
                        {formatDateTimeEs(evt.event_datetime)}
                      </p>
                      {evt.is_recurring && (
                        <p className="mt-1 font-mono text-[13px] text-[#0E7490]">
                          [CICLO CADA {evt.recurrence_interval_days} DIAS]
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
