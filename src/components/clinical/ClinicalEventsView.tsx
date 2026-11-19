"use client";

import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Edit3,
  MapPin,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type {
  ClinicalEventItem,
  CommandCenterSnapshot,
  EventCategory,
} from "@/lib/types/clinical";
import {
  EVENT_CATEGORY_LABEL,
  EVENT_CATEGORY_TAG,
} from "@/lib/clinical-labels";
import {
  cn,
  formatCurrencyMxn,
  formatDateTimeEs,
  getDaysUntil,
  toLocalDateTimeInput,
} from "@/lib/utils";
import { CascadeTimeline } from "./CascadeTimeline";
import { ClinicalModal } from "./ClinicalModal";
import { IconActionButton } from "./IconActionButton";
import { StatusBadge } from "./StatusBadge";

export interface SaveClinicalEventPayload {
  event_id?: string;
  title: string;
  category: EventCategory;
  specialist_or_center: string | null;
  location_address: string | null;
  event_datetime: string;
  is_recurring: boolean;
  recurrence_interval_days: number | null;
  medication_id: string | null;
  preparation_instructions: string | null;
  estimated_cost: number | null;
  actual_cost?: number | null;
  periodicity_label: string | null;
  date_is_estimated: boolean;
  notes: string | null;
}

interface ClinicalEventsViewProps {
  snapshot: CommandCenterSnapshot;
  isAdmin: boolean;
  onSaveEvent: (payload: SaveClinicalEventPayload) => Promise<void>;
  onCompleteEvent: (
    eventId: string,
    options?: {
      actual_cost?: number | null;
      notes?: string | null;
      log_expense?: boolean;
    }
  ) => Promise<void>;
  onRescheduleEvent: (eventId: string, newDatetime: string) => Promise<void>;
  onReopenEvent: (eventId: string) => Promise<void>;
  onDeleteEvent: (eventId: string) => Promise<void>;
}

function parseOptionalNonNeg(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function ClinicalEventsView({
  snapshot,
  isAdmin,
  onSaveEvent,
  onCompleteEvent,
  onRescheduleEvent,
  onReopenEvent,
  onDeleteEvent,
}: ClinicalEventsViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  // Modal Create / Edit Event
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ClinicalEventItem | null>(
    null
  );
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EventCategory>("APPOINTMENT");
  const [eventDatetime, setEventDatetime] = useState(
    toLocalDateTimeInput(new Date(Date.now() + 7 * 86400000).toISOString())
  );
  const [specialist, setSpecialist] = useState("");
  const [locationAddr, setLocationAddr] = useState("");
  const [medicationId, setMedicationId] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceDays, setRecurrenceDays] = useState("21");
  const [periodicityLabel, setPeriodicityLabel] = useState("");
  const [dateIsEstimated, setDateIsEstimated] = useState(false);
  const [prepInstructions, setPrepInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [eventFormError, setEventFormError] = useState<string | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);

  // Modal Reschedule Event
  const [rescheduleTarget, setRescheduleTarget] =
    useState<ClinicalEventItem | null>(null);
  const [rescheduleDatetime, setRescheduleDatetime] = useState("");
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [savingReschedule, setSavingReschedule] = useState(false);

  // Modal Complete Event
  const [completeTarget, setCompleteTarget] =
    useState<ClinicalEventItem | null>(null);
  const [completeActualCost, setCompleteActualCost] = useState("");
  const [completeLogExpense, setCompleteLogExpense] = useState(true);
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [savingComplete, setSavingComplete] = useState(false);

  // Busy & 2-step delete
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);

  const filteredUpcoming = snapshot.upcoming_events.filter(
    (e) => categoryFilter === "ALL" || e.category === categoryFilter
  );
  const filteredCompleted = snapshot.completed_events.filter(
    (e) => categoryFilter === "ALL" || e.category === categoryFilter
  );

  function openCreateModal() {
    setEditingEvent(null);
    setTitle("");
    setCategory("APPOINTMENT");
    setEventDatetime(
      toLocalDateTimeInput(new Date(Date.now() + 7 * 86400000).toISOString())
    );
    setSpecialist("");
    setLocationAddr("");
    setMedicationId("");
    setEstimatedCost("");
    setActualCost("");
    setIsRecurring(false);
    setRecurrenceDays("21");
    setPeriodicityLabel("");
    setDateIsEstimated(false);
    setPrepInstructions("");
    setNotes("");
    setEventFormError(null);
    setEventModalOpen(true);
  }

  function openEditModal(evt: ClinicalEventItem) {
    setEditingEvent(evt);
    setTitle(evt.title);
    setCategory(evt.category);
    setEventDatetime(toLocalDateTimeInput(evt.event_datetime));
    setSpecialist(evt.specialist_or_center ?? "");
    setLocationAddr(evt.location_address ?? "");
    setMedicationId(evt.medication_id ?? "");
    setEstimatedCost(
      evt.estimated_cost === null ? "" : String(evt.estimated_cost)
    );
    setActualCost(evt.actual_cost === null ? "" : String(evt.actual_cost));
    setIsRecurring(evt.is_recurring);
    setRecurrenceDays(
      evt.recurrence_interval_days ? String(evt.recurrence_interval_days) : "21"
    );
    setPeriodicityLabel(evt.periodicity_label ?? "");
    setDateIsEstimated(evt.date_is_estimated);
    setPrepInstructions(evt.preparation_instructions ?? "");
    setNotes(evt.notes ?? "");
    setEventFormError(null);
    setEventModalOpen(true);
  }

  async function handleSaveEventSubmit(e: FormEvent) {
    e.preventDefault();
    setEventFormError(null);

    if (!title.trim()) {
      setEventFormError("Ingresa el titulo de la cita o procedimiento.");
      return;
    }

    const parsedDate = new Date(eventDatetime);
    if (Number.isNaN(parsedDate.getTime())) {
      setEventFormError("Selecciona una fecha y hora validas.");
      return;
    }

    const parsedInterval = isRecurring
      ? Number.parseInt(recurrenceDays || "21", 10)
      : null;
    if (isRecurring && (!parsedInterval || parsedInterval <= 0)) {
      setEventFormError("La recurrencia en dias debe ser mayor a 0.");
      return;
    }

    const payload: SaveClinicalEventPayload = {
      ...(editingEvent ? { event_id: editingEvent.id } : {}),
      title: title.trim(),
      category,
      specialist_or_center: specialist.trim() || null,
      location_address: locationAddr.trim() || null,
      event_datetime: parsedDate.toISOString(),
      is_recurring: isRecurring,
      recurrence_interval_days: parsedInterval,
      medication_id: medicationId || null,
      preparation_instructions: prepInstructions.trim() || null,
      estimated_cost: parseOptionalNonNeg(estimatedCost),
      ...(editingEvent ? { actual_cost: parseOptionalNonNeg(actualCost) } : {}),
      periodicity_label: periodicityLabel.trim() || null,
      date_is_estimated: dateIsEstimated,
      notes: notes.trim() || null,
    };

    setSavingEvent(true);
    try {
      await onSaveEvent(payload);
      setEventModalOpen(false);
    } catch (err) {
      setEventFormError(
        err instanceof Error ? err.message : "No se pudo guardar el evento."
      );
    } finally {
      setSavingEvent(false);
    }
  }

  function openRescheduleModal(evt: ClinicalEventItem) {
    setRescheduleTarget(evt);
    setRescheduleDatetime(toLocalDateTimeInput(evt.event_datetime));
    setRescheduleError(null);
  }

  async function handleRescheduleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rescheduleTarget) return;
    setRescheduleError(null);

    const parsed = new Date(rescheduleDatetime);
    if (Number.isNaN(parsed.getTime())) {
      setRescheduleError("Selecciona una nueva fecha y hora validas.");
      return;
    }

    setSavingReschedule(true);
    try {
      await onRescheduleEvent(rescheduleTarget.id, parsed.toISOString());
      setRescheduleTarget(null);
    } catch (err) {
      setRescheduleError(
        err instanceof Error ? err.message : "Error al reprogramar."
      );
    } finally {
      setSavingReschedule(false);
    }
  }

  function openCompleteModal(evt: ClinicalEventItem) {
    setCompleteTarget(evt);
    const defaultCost = evt.actual_cost ?? evt.estimated_cost;
    setCompleteActualCost(defaultCost === null ? "" : String(defaultCost));
    setCompleteLogExpense(defaultCost !== null && defaultCost > 0);
    setCompleteNotes(evt.notes ?? "");
    setCompleteError(null);
  }

  async function handleCompleteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!completeTarget) return;
    setCompleteError(null);

    const costNum = parseOptionalNonNeg(completeActualCost);
    setSavingComplete(true);
    try {
      await onCompleteEvent(completeTarget.id, {
        actual_cost: costNum,
        notes: completeNotes.trim() || null,
        log_expense: completeLogExpense && costNum !== null && costNum >= 0,
      });
      setCompleteTarget(null);
    } catch (err) {
      setCompleteError(
        err instanceof Error ? err.message : "No se pudo completar el evento."
      );
    } finally {
      setSavingComplete(false);
    }
  }

  return (
    <div className="space-y-5 clinical-enter">
      {/* Encabezado y Controles */}
      <section className="clinical-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-[#0F172A]">
              Agenda Clinica: Citas, Inyecciones y Estudios
            </h2>
            <p className="mt-1 text-[14px] text-[#475569]">
              Control de fechas oficiales vs estimadas, preparacion previa y
              recordatorios automaticos escalonados (-7d, -3d, -1d, 0d).
            </p>
          </div>

          <IconActionButton
            icon={Plus}
            label="Agendar nueva cita, estudio o inyeccion"
            shortLabel="Nuevo Evento"
            tone="primary"
            onClick={openCreateModal}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E2E8F0]">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["ALL", "Todos"],
                ["APPOINTMENT", "Citas"],
                ["INJECTION", "Inyecciones"],
                ["LAB_TEST", "Estudios"],
                ["PROCEDURE", "Procedimientos"],
                ["OTHER", "Otros"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCategoryFilter(key)}
                className={cn(
                  "px-3 py-1.5 rounded-[4px] border text-[13px] font-medium cursor-pointer",
                  categoryFilter === key
                    ? "bg-[#0E7490] border-[#0E7490] text-white"
                    : "bg-white border-[#CBD5E1] text-[#334155] hover:bg-[#F8FAFC]"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            aria-label="Guia visual de acciones"
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 rounded-[6px]"
          >
            <span className="font-semibold text-[#0F172A]">Simbolos:</span>
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#065F46]" aria-hidden="true" />
              Completar
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5 text-[#0E7490]" aria-hidden="true" />
              Reprogramar
            </span>
            <span className="inline-flex items-center gap-1">
              <Edit3 className="w-3.5 h-3.5 text-[#334155]" aria-hidden="true" />
              Editar
            </span>
            {isAdmin && (
              <span className="inline-flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5 text-[#991B1B]" aria-hidden="true" />
                Eliminar
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Proximos Eventos */}
      <section aria-label="Proximos eventos clinicos" className="space-y-3">
        {filteredUpcoming.length === 0 ? (
          <div className="clinical-card p-8 text-center text-[14px] text-[#475569]">
            No hay eventos pendientes en esta categoria.
          </div>
        ) : (
          filteredUpcoming.map((evt) => {
            const daysLeft = getDaysUntil(evt.event_datetime);
            const isConfirmDel = confirmDeleteId === evt.id;
            return (
              <article
                key={evt.id}
                className={cn(
                  "clinical-card p-5 space-y-3",
                  daysLeft <= 1 && "border-[#F59E0B] bg-[#FFFBEB]/40"
                )}
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        label={EVENT_CATEGORY_TAG[evt.category]}
                        tone={evt.category === "INJECTION" ? "warn" : "info"}
                      />
                      <StatusBadge
                        label={
                          evt.date_is_estimated
                            ? "[FECHA ESTIMADA]"
                            : "[FECHA OFICIAL]"
                        }
                        tone={evt.date_is_estimated ? "warn" : "ok"}
                      />
                      {evt.is_recurring && evt.recurrence_interval_days && (
                        <StatusBadge
                          label={`[CADA ${evt.recurrence_interval_days}D]`}
                          tone="neutral"
                        />
                      )}
                      {daysLeft <= 7 && (
                        <StatusBadge
                          label={
                            daysLeft <= 0
                              ? "[HOY]"
                              : `[EN ${daysLeft} DIA${daysLeft === 1 ? "" : "S"}]`
                          }
                          tone={daysLeft <= 1 ? "crit" : "warn"}
                        />
                      )}
                    </div>

                    <h3 className="text-[17px] font-bold text-[#0F172A]">
                      {evt.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-[#334155]">
                      <span className="font-mono font-semibold text-[#0E7490] tabular-nums">
                        {formatDateTimeEs(evt.event_datetime)}
                      </span>
                      {evt.specialist_or_center && (
                        <span>Especialista / Sede: {evt.specialist_or_center}</span>
                      )}
                      {evt.location_address && (
                        <span className="inline-flex items-center gap-1 text-[13px] text-[#475569]">
                          <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                          {evt.location_address}
                        </span>
                      )}
                      {evt.estimated_cost !== null && (
                        <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                          Costo est.: {formatCurrencyMxn(evt.estimated_cost)}
                        </span>
                      )}
                      {evt.medication_name && (
                        <span className="text-[13px] text-[#065F46] font-medium">
                          Vinculado a: {evt.medication_name}
                        </span>
                      )}
                    </div>

                    {evt.preparation_instructions && (
                      <p className="text-[13px] text-[#334155] bg-[#F8FAFC] border-l-2 border-[#0E7490] px-3 py-1.5">
                        Preparacion: {evt.preparation_instructions}
                      </p>
                    )}

                    {evt.notes && (
                      <p className="text-[13px] text-[#475569]">
                        Notas: {evt.notes}
                      </p>
                    )}

                    {evt.cascade_alerts.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[12px] font-semibold text-[#475569] mb-1">
                          {isAdmin
                            ? "Linea de recordatorios en cascada (Telegram Bot: -7d, -3d, -1d, 0d)"
                            : "Recordatorios programados (-7d, -3d, -1d, 0d)"}
                        </p>
                        <CascadeTimeline alerts={evt.cascade_alerts} />
                      </div>
                    )}
                  </div>

                  {/* Acciones con Simbolos */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <IconActionButton
                      icon={CheckCircle2}
                      label={`Marcar como realizado: ${evt.title}`}
                      tone="success"
                      onClick={() => openCompleteModal(evt)}
                    />
                    <IconActionButton
                      icon={CalendarClock}
                      label={`Reprogramar fecha/hora de ${evt.title}`}
                      tone="info"
                      onClick={() => openRescheduleModal(evt)}
                    />
                    <IconActionButton
                      icon={Edit3}
                      label={`Editar detalles de ${evt.title}`}
                      tone="neutral"
                      onClick={() => openEditModal(evt)}
                    />

                    {isAdmin &&
                      (isConfirmDel ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busyKey === `del:${evt.id}`}
                            onClick={async () => {
                              setBusyKey(`del:${evt.id}`);
                              try {
                                await onDeleteEvent(evt.id);
                                setConfirmDeleteId(null);
                              } catch {
                                // Toast
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
                          label={`Eliminar evento ${evt.title}`}
                          tone="danger"
                          onClick={() => setConfirmDeleteId(evt.id)}
                        />
                      ))}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      {/* Historial de Eventos Completados */}
      {filteredCompleted.length > 0 && (
        <section className="clinical-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-[#0F172A]">
              Historial de Eventos Realizados ({filteredCompleted.length})
            </h3>
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className="text-[13px] font-semibold text-[#0E7490] hover:underline cursor-pointer"
            >
              {showCompleted ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          {showCompleted && (
            <div className="space-y-2.5">
              {filteredCompleted.map((evt) => {
                const isConfirmDel = confirmDeleteId === evt.id;
                return (
                  <div
                    key={evt.id}
                    className="p-3.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={EVENT_CATEGORY_TAG[evt.category]}
                          tone="neutral"
                        />
                        <span className="font-bold text-[15px] text-[#0F172A]">
                          {evt.title}
                        </span>
                      </div>
                      <p className="text-[13px] text-[#475569] font-mono tabular-nums">
                        Fecha: {formatDateTimeEs(evt.event_datetime)}
                        {evt.actual_cost !== null
                          ? ` | Costo real: ${formatCurrencyMxn(evt.actual_cost)}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <IconActionButton
                        icon={RotateCcw}
                        label={`Reabrir ${evt.title} a pendientes`}
                        tone="info"
                        loading={busyKey === `reopen:${evt.id}`}
                        onClick={async () => {
                          setBusyKey(`reopen:${evt.id}`);
                          try {
                            await onReopenEvent(evt.id);
                          } catch {
                            // Toast
                          } finally {
                            setBusyKey(null);
                          }
                        }}
                      />

                      {isAdmin &&
                        (isConfirmDel ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyKey === `del:${evt.id}`}
                              onClick={async () => {
                                setBusyKey(`del:${evt.id}`);
                                try {
                                  await onDeleteEvent(evt.id);
                                  setConfirmDeleteId(null);
                                } catch {
                                  // Toast
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
                            label={`Eliminar historial de ${evt.title}`}
                            tone="danger"
                            onClick={() => setConfirmDeleteId(evt.id)}
                          />
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Modal: Crear / Editar Evento */}
      <ClinicalModal
        open={eventModalOpen}
        onClose={() => !savingEvent && setEventModalOpen(false)}
        title={
          editingEvent
            ? `Editar Evento: ${editingEvent.title}`
            : "Programar Nuevo Evento Clinico"
        }
        subtitle="Cita medica, aplicacion de inyeccion, analisis clinico o procedimiento."
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleSaveEventSubmit} className="space-y-4">
          {eventFormError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px] flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{eventFormError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label
                htmlFor="evt-title"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Titulo del evento *
              </label>
              <input
                id="evt-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Inyeccion Fluanxol 20 mg o Consulta Psiquiatria"
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-category"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Categoria
              </label>
              <select
                id="evt-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as EventCategory)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
              >
                {(
                  [
                    "APPOINTMENT",
                    "INJECTION",
                    "LAB_TEST",
                    "PROCEDURE",
                    "OTHER",
                  ] as EventCategory[]
                ).map((cat) => (
                  <option key={cat} value={cat}>
                    {EVENT_CATEGORY_LABEL[cat]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="evt-datetime"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Fecha y hora local *
              </label>
              <input
                id="evt-datetime"
                type="datetime-local"
                required
                value={eventDatetime}
                onChange={(e) => setEventDatetime(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-specialist"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Especialista / Clinica
              </label>
              <input
                id="evt-specialist"
                type="text"
                value={specialist}
                onChange={(e) => setSpecialist(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-location"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Direccion / Consultorio
              </label>
              <input
                id="evt-location"
                type="text"
                value={locationAddr}
                onChange={(e) => setLocationAddr(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-medication"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Medicamento vinculado (opcional)
              </label>
              <select
                id="evt-medication"
                value={medicationId}
                onChange={(e) => setMedicationId(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
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
                htmlFor="evt-estimated-cost"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Costo estimado (MXN)
              </label>
              <input
                id="evt-estimated-cost"
                type="number"
                step="0.01"
                min="0"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            {editingEvent && (
              <div>
                <label
                  htmlFor="evt-actual-cost"
                  className="block text-[13px] font-semibold text-[#0F172A] mb-1"
                >
                  Costo real pagado (MXN)
                </label>
                <input
                  id="evt-actual-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={actualCost}
                  onChange={(e) => setActualCost(e.target.value)}
                  className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="evt-periodicity"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Etiqueta de periodicidad (ej. Cada 3 semanas)
              </label>
              <input
                id="evt-periodicity"
                type="text"
                value={periodicityLabel}
                onChange={(e) => setPeriodicityLabel(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>
          </div>

          <div className="p-3.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] space-y-2.5">
            <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
              <input
                type="checkbox"
                checked={dateIsEstimated}
                onChange={(e) => setDateIsEstimated(e.target.checked)}
                className="w-4 h-4 accent-[#0E7490]"
              />
              Fecha estimada / tentativa (desmarcar cuando sea fecha oficial confirmada)
            </label>

            <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="w-4 h-4 accent-[#0E7490]"
              />
              Ciclo recurrente automatico al completarse
            </label>

            {isRecurring && (
              <div className="pl-6">
                <label
                  htmlFor="evt-interval"
                  className="block text-[12px] font-semibold text-[#0F172A] mb-1"
                >
                  Repetir cada (dias)
                </label>
                <input
                  id="evt-interval"
                  type="number"
                  min="1"
                  max="365"
                  value={recurrenceDays}
                  onChange={(e) => setRecurrenceDays(e.target.value)}
                  className="clinical-input max-w-[140px] border border-[#CBD5E1] px-3 font-mono text-[14px] bg-white"
                />
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="evt-prep"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Instrucciones de preparacion (ej. ayuno, estudios previos)
            </label>
            <textarea
              id="evt-prep"
              rows={2}
              value={prepInstructions}
              onChange={(e) => setPrepInstructions(e.target.value)}
              className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]"
            />
          </div>

          <div>
            <label
              htmlFor="evt-notes"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Notas adicionales
            </label>
            <textarea
              id="evt-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setEventModalOpen(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingEvent}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold inline-flex items-center gap-2"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              {savingEvent
                ? "Guardando..."
                : editingEvent
                ? "Guardar Cambios"
                : "Agendar Evento"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Reprogramar Evento */}
      <ClinicalModal
        open={Boolean(rescheduleTarget)}
        onClose={() => !savingReschedule && setRescheduleTarget(null)}
        title={`Reprogramar: ${rescheduleTarget?.title ?? ""}`}
        subtitle="Confirma la nueva fecha y hora y regenera los recordatorios -7d, -3d, -1d y 0d."
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleRescheduleSubmit} className="space-y-4">
          {rescheduleError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
            >
              {rescheduleError}
            </div>
          )}

          <div>
            <label
              htmlFor="resched-datetime"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Nueva fecha y hora local *
            </label>
            <input
              id="resched-datetime"
              type="datetime-local"
              required
              value={rescheduleDatetime}
              onChange={(e) => setRescheduleDatetime(e.target.value)}
              className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setRescheduleTarget(null)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingReschedule}
              className="clinical-btn px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold"
            >
              {savingReschedule ? "Reprogramando..." : "Guardar Nueva Fecha"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Completar Evento */}
      <ClinicalModal
        open={Boolean(completeTarget)}
        onClose={() => !savingComplete && setCompleteTarget(null)}
        title={`Marcar Realizado: ${completeTarget?.title ?? ""}`}
        subtitle={
          completeTarget?.is_recurring && completeTarget.recurrence_interval_days
            ? `Al confirmar, se programara automaticamente el siguiente ciclo (+${completeTarget.recurrence_interval_days} dias).`
            : "Registra el cierre del evento y el gasto si aplica."
        }
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleCompleteSubmit} className="space-y-4">
          {completeError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
            >
              {completeError}
            </div>
          )}

          <div>
            <label
              htmlFor="comp-cost"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Costo real pagado (MXN, opcional)
            </label>
            <input
              id="comp-cost"
              type="number"
              step="0.01"
              min="0"
              value={completeActualCost}
              onChange={(e) => setCompleteActualCost(e.target.value)}
              className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
            <input
              type="checkbox"
              checked={completeLogExpense}
              onChange={(e) => setCompleteLogExpense(e.target.checked)}
              className="w-4 h-4 accent-[#0E7490]"
            />
            Registrar gasto automaticamente en Finanzas y Quincenas
          </label>

          <div>
            <label
              htmlFor="comp-notes"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Notas o resultados del evento
            </label>
            <textarea
              id="comp-notes"
              rows={2}
              value={completeNotes}
              onChange={(e) => setCompleteNotes(e.target.value)}
              className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setCompleteTarget(null)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingComplete}
              className="clinical-btn px-4 bg-[#065F46] hover:bg-[#047857] text-white text-[14px] font-semibold"
            >
              {savingComplete ? "Completando..." : "Confirmar Realizado"}
            </button>
          </div>
        </form>
      </ClinicalModal>
    </div>
  );
}
