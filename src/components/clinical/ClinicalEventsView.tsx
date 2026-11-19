"use client";

import { useState, type FormEvent } from "react";
import {
  CalendarPlus,
  CheckCircle2,
  Edit3,
  Repeat,
  RotateCcw,
  Syringe,
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
import { cn, formatCurrencyMxn, formatDateTimeEs } from "@/lib/utils";
import { CascadeTimeline } from "./CascadeTimeline";
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
  periodicity_label: string | null;
  date_is_estimated: boolean;
  notes: string | null;
}

interface ClinicalEventsViewProps {
  snapshot: CommandCenterSnapshot;
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

export function ClinicalEventsView({
  snapshot,
  onSaveEvent,
  onCompleteEvent,
  onRescheduleEvent,
  onReopenEvent,
  onDeleteEvent,
}: ClinicalEventsViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  // Formulario Crear / Editar
  const [showForm, setShowForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EventCategory>("APPOINTMENT");
  const [specialist, setSpecialist] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [eventDatetime, setEventDatetime] = useState(() => {
    const d = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceDays, setRecurrenceDays] = useState("60");
  const [periodicityLabel, setPeriodicityLabel] = useState("");
  const [dateIsEstimated, setDateIsEstimated] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState("");
  const [medicationId, setMedicationId] = useState<string>("");
  const [prepInstructions, setPrepInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Acciones inline
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDatetime, setRescheduleDatetime] = useState("");
  const [completingEventId, setCompletingEventId] = useState<string | null>(
    null
  );
  const [completeCost, setCompleteCost] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeLogExpense, setCompleteLogExpense] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);

  function resetForm() {
    setEditingEventId(null);
    setTitle("");
    setCategory("APPOINTMENT");
    setSpecialist("");
    setLocationAddress("");
    const d = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    setEventDatetime(d.toISOString().slice(0, 16));
    setIsRecurring(false);
    setRecurrenceDays("60");
    setPeriodicityLabel("");
    setDateIsEstimated(false);
    setEstimatedCost("");
    setMedicationId("");
    setPrepInstructions("");
    setNotes("");
    setFormError(null);
  }

  function startEditEvent(evt: ClinicalEventItem) {
    setEditingEventId(evt.id);
    setTitle(evt.title);
    setCategory(evt.category);
    setSpecialist(evt.specialist_or_center ?? "");
    setLocationAddress(evt.location_address ?? "");
    setEventDatetime(new Date(evt.event_datetime).toISOString().slice(0, 16));
    setIsRecurring(evt.is_recurring);
    setRecurrenceDays(String(evt.recurrence_interval_days ?? 60));
    setPeriodicityLabel(evt.periodicity_label ?? "");
    setDateIsEstimated(evt.date_is_estimated);
    setEstimatedCost(
      evt.estimated_cost !== null ? String(evt.estimated_cost) : ""
    );
    setMedicationId(evt.medication_id ?? "");
    setPrepInstructions(evt.preparation_instructions ?? "");
    setNotes(evt.notes ?? "");
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!title.trim()) {
      setFormError("Escribe el titulo del evento clinico.");
      return;
    }
    const iso = new Date(eventDatetime).toISOString();
    const interval = isRecurring ? Number(recurrenceDays) : null;
    if (isRecurring && (!interval || interval <= 0)) {
      setFormError("Especifica un intervalo de recurrencia en dias mayor a 0.");
      return;
    }

    const parsedCost =
      estimatedCost.trim() !== "" && Number.isFinite(Number(estimatedCost))
        ? Number(estimatedCost)
        : null;

    setSubmitting(true);
    try {
      await onSaveEvent({
        event_id: editingEventId ?? undefined,
        title: title.trim(),
        category,
        specialist_or_center: specialist.trim() || null,
        location_address: locationAddress.trim() || null,
        event_datetime: iso,
        is_recurring: isRecurring,
        recurrence_interval_days: interval,
        medication_id: medicationId || null,
        preparation_instructions: prepInstructions.trim() || null,
        estimated_cost: parsedCost,
        periodicity_label: periodicityLabel.trim() || null,
        date_is_estimated: dateIsEstimated,
        notes: notes.trim() || null,
      });
      resetForm();
      setShowForm(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Error al guardar evento."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitComplete(evt: ClinicalEventItem) {
    setBusyEventId(evt.id);
    try {
      const costVal =
        completeCost.trim() !== "" && Number.isFinite(Number(completeCost))
          ? Number(completeCost)
          : null;
      await onCompleteEvent(evt.id, {
        actual_cost: costVal,
        notes: completeNotes.trim() || null,
        log_expense: completeLogExpense && costVal !== null && costVal > 0,
      });
      setCompletingEventId(null);
      setCompleteCost("");
      setCompleteNotes("");
    } finally {
      setBusyEventId(null);
    }
  }

  async function handleRescheduleSave(evt: ClinicalEventItem) {
    if (!rescheduleDatetime) return;
    setBusyEventId(evt.id);
    try {
      await onRescheduleEvent(evt.id, new Date(rescheduleDatetime).toISOString());
      setRescheduleId(null);
    } finally {
      setBusyEventId(null);
    }
  }

  const upcomingFiltered =
    categoryFilter === "ALL"
      ? snapshot.upcoming_events
      : snapshot.upcoming_events.filter((e) => e.category === categoryFilter);

  return (
    <div className="space-y-6 clinical-enter">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-[#0F172A]">
            Agenda Clinica, Estudios y Ciclos Recurrentes
          </h2>
          <p className="text-[14px] text-[#475569]">
            Consultas, estudios e inyecciones con costos estimados, fechas
            confirmadas/estimadas, cascada de recordatorios y cierre con gasto real.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (showForm && !editingEventId) {
              setShowForm(false);
            } else {
              resetForm();
              setShowForm(true);
            }
          }}
          className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
        >
          <CalendarPlus
            className="w-4 h-4"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {showForm ? "Cerrar Formulario" : "Programar Evento Clinico"}
        </button>
      </div>

      {/* Filtros por categoria */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["ALL", `Todos (${snapshot.upcoming_events.length})`],
            ["APPOINTMENT", "Consultas"],
            ["LAB_TEST", "Estudios / Lab / RX"],
            ["INJECTION", "Inyecciones"],
            ["PROCEDURE", "Procedimientos"],
          ] as const
        ).map(([cat, label]) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(cat)}
            className={cn(
              "clinical-btn px-3.5 text-[13px] font-semibold border",
              categoryFilter === cat
                ? "bg-[#0F172A] border-[#0F172A] text-white"
                : "bg-white border-[#CBD5E1] text-[#334155] hover:bg-[#F8FAFC]"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Formulario Crear / Editar */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="clinical-card p-5 space-y-4 border-[#A5F3FC]"
        >
          <h3 className="text-[16px] font-bold text-[#0F172A] border-b border-[#E2E8F0] pb-2.5">
            {editingEventId
              ? `Editar Evento Clinico: ${title}`
              : "Nuevo Evento Medico o Estudio"}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label
                htmlFor="evt-title"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Titulo del evento *
              </label>
              <input
                id="evt-title"
                type="text"
                required
                placeholder="Ej. Consulta Psiquiatria / Analisis Clinicos"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-category"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Categoria *
              </label>
              <select
                id="evt-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as EventCategory)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
              >
                <option value="APPOINTMENT">Cita Medica</option>
                <option value="INJECTION">Inyeccion</option>
                <option value="LAB_TEST">Estudio / Laboratorio / RX</option>
                <option value="PROCEDURE">Procedimiento</option>
                <option value="OTHER">Otro Evento</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="evt-datetime"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Fecha y hora programada *
              </label>
              <input
                id="evt-datetime"
                type="datetime-local"
                required
                value={eventDatetime}
                onChange={(e) => setEventDatetime(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="evt-cost"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Costo estimado (MXN)
              </label>
              <input
                id="evt-cost"
                type="number"
                min="0"
                step="0.01"
                placeholder="Ej. 1500.00"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="evt-period-label"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Periodicidad legible (opcional)
              </label>
              <input
                id="evt-period-label"
                type="text"
                placeholder="Ej. Cada 3 o 4 meses / Indeterminada"
                value={periodicityLabel}
                onChange={(e) => setPeriodicityLabel(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-specialist"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Especialista o centro medico
              </label>
              <input
                id="evt-specialist"
                type="text"
                placeholder="Ej. Psiquiatria Comalcalco"
                value={specialist}
                onChange={(e) => setSpecialist(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-location"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Ubicacion / Consultorio
              </label>
              <input
                id="evt-location"
                type="text"
                placeholder="Ciudad, hospital o domicilio"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-med"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Vincular a inventario (opcional)
              </label>
              <select
                id="evt-med"
                value={medicationId}
                onChange={(e) => setMedicationId(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
              >
                <option value="">Sin descuento de inventario</option>
                {snapshot.medications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (Stock: {m.current_stock ?? "Pendiente"}{" "}
                    {m.presentation})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end pb-1">
              <label
                htmlFor="evt-estimated-flag"
                className="inline-flex items-center gap-2.5 h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] w-full cursor-pointer bg-[#F8FAFC]"
              >
                <input
                  id="evt-estimated-flag"
                  type="checkbox"
                  checked={dateIsEstimated}
                  onChange={(e) => setDateIsEstimated(e.target.checked)}
                  className="w-4 h-4 accent-[#0E7490]"
                />
                <span className="text-[14px] font-medium text-[#0F172A]">
                  Fecha proxima estimada
                </span>
              </label>
            </div>

            <div className="flex items-end pb-1">
              <label
                htmlFor="evt-recurring"
                className="inline-flex items-center gap-2.5 h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] w-full cursor-pointer bg-[#F8FAFC]"
              >
                <input
                  id="evt-recurring"
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="w-4 h-4 accent-[#0E7490]"
                />
                <span className="text-[14px] font-medium text-[#0F172A]">
                  Evento ciclico recurrente
                </span>
              </label>
            </div>

            {isRecurring && (
              <div>
                <label
                  htmlFor="evt-interval"
                  className="block text-[14px] font-medium text-[#0F172A] mb-1"
                >
                  Repetir cada (dias)
                </label>
                <input
                  id="evt-interval"
                  type="number"
                  min="1"
                  value={recurrenceDays}
                  onChange={(e) => setRecurrenceDays(e.target.value)}
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
                />
              </div>
            )}

            <div className="md:col-span-3">
              <label
                htmlFor="evt-prep"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Instrucciones previas y preparacion
              </label>
              <textarea
                id="evt-prep"
                rows={2}
                placeholder="Requisitos de ayuno, estudios previos o indicaciones"
                value={prepInstructions}
                onChange={(e) => setPrepInstructions(e.target.value)}
                className="w-full p-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="evt-notes"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Notas adicionales o acuerdos medicos
              </label>
              <input
                id="evt-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
              />
            </div>
          </div>

          {formError && (
            <p className="text-[14px] font-medium text-[#991B1B]" role="alert">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[15px] font-bold"
            >
              {submitting
                ? "Guardando..."
                : editingEventId
                ? "Guardar Cambios"
                : "Guardar y Generar Alertas (-7d/-3d/-1d/0d)"}
            </button>
          </div>
        </form>
      )}

      {/* Lista de Eventos Activos */}
      <section aria-labelledby="upcoming-events-heading" className="space-y-4">
        <h3
          id="upcoming-events-heading"
          className="text-[16px] font-bold text-[#0F172A]"
        >
          Eventos Programados ({upcomingFiltered.length})
        </h3>

        {upcomingFiltered.length === 0 ? (
          <div className="clinical-card p-6 text-center text-[#475569]">
            No existen eventos clinicos en este filtro.
          </div>
        ) : (
          <div className="space-y-4">
            {upcomingFiltered.map((evt) => (
              <article key={evt.id} className="clinical-card p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        label={EVENT_CATEGORY_TAG[evt.category]}
                        tone="info"
                      />
                      <span className="text-[13px] font-medium text-[#475569]">
                        {EVENT_CATEGORY_LABEL[evt.category]}
                      </span>
                      {(evt.is_recurring || evt.periodicity_label) && (
                        <StatusBadge
                          label={`[${(
                            evt.periodicity_label ??
                            `CADA ${evt.recurrence_interval_days} DIAS`
                          ).toUpperCase()}]`}
                          tone="warn"
                        />
                      )}
                      {evt.date_is_estimated && (
                        <StatusBadge label="[FECHA ESTIMADA]" tone="neutral" />
                      )}
                      {evt.estimated_cost !== null && evt.estimated_cost > 0 && (
                        <StatusBadge
                          label={`EST. ${formatCurrencyMxn(evt.estimated_cost)}`}
                          tone="ok"
                        />
                      )}
                      {evt.medication_name && (
                        <StatusBadge
                          label={`[VINCULADO: ${evt.medication_name}]`}
                          tone="neutral"
                        />
                      )}
                    </div>
                    <h4 className="text-[18px] font-bold text-[#0F172A]">
                      {evt.title}
                    </h4>
                    <p className="font-mono text-[14px] text-[#0E7490] font-semibold tabular-nums">
                      Fecha: {formatDateTimeEs(evt.event_datetime)}
                    </p>
                    {(evt.specialist_or_center || evt.location_address) && (
                      <p className="text-[14px] text-[#475569]">
                        {[evt.specialist_or_center, evt.location_address]
                          .filter(Boolean)
                          .join(" | ")}
                      </p>
                    )}
                    {evt.preparation_instructions && (
                      <p className="text-[14px] text-[#334155] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[4px] p-2.5 mt-2">
                        <strong className="font-semibold">Preparacion:</strong>{" "}
                        {evt.preparation_instructions}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEditEvent(evt)}
                      className="clinical-btn inline-flex items-center gap-1 px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px] font-medium"
                    >
                      <Edit3
                        className="w-3.5 h-3.5"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      Editar
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setRescheduleId(
                          rescheduleId === evt.id ? null : evt.id
                        );
                        setRescheduleDatetime(
                          new Date(evt.event_datetime)
                            .toISOString()
                            .slice(0, 16)
                        );
                      }}
                      className="clinical-btn px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px] font-medium"
                    >
                      Reprogramar
                    </button>

                    <button
                      type="button"
                      disabled={busyEventId === evt.id}
                      onClick={() => {
                        setCompletingEventId(
                          completingEventId === evt.id ? null : evt.id
                        );
                        setCompleteCost(
                          evt.estimated_cost !== null
                            ? String(evt.estimated_cost)
                            : ""
                        );
                        setCompleteNotes(evt.notes ?? "");
                      }}
                      className="clinical-btn inline-flex items-center gap-2 px-3.5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[13px] font-bold"
                    >
                      {evt.category === "INJECTION" ? (
                        <Syringe
                          className="w-4 h-4"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      ) : (
                        <CheckCircle2
                          className="w-4 h-4"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      )}
                      {evt.is_recurring
                        ? "Confirmar y Renovar"
                        : "Completar"}
                    </button>

                    {confirmDeleteId === evt.id ? (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await onDeleteEvent(evt.id);
                            setConfirmDeleteId(null);
                          }}
                          className="clinical-btn px-3 bg-[#991B1B] text-white text-[13px] font-bold"
                        >
                          Confirmar Borrar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white text-[13px]"
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(evt.id)}
                        className="clinical-btn px-2.5 border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#991B1B]"
                        aria-label={`Eliminar evento ${evt.title}`}
                      >
                        <Trash2
                          className="w-4 h-4"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </div>
                </div>

                {/* Panel inline de cierre con costo real y registro de gasto */}
                {completingEventId === evt.id && (
                  <div className="p-3.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-[6px] space-y-3">
                    <div className="text-[14px] font-bold text-[#065F46]">
                      Confirmar Realizacion de Evento
                      {evt.is_recurring
                        ? ` (generara siguiente ciclo en +${evt.recurrence_interval_days} dias)`
                        : ""}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="block text-[12px] font-medium text-[#065F46] mb-1">
                          Costo real pagado (MXN opc.)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={completeCost}
                          onChange={(e) => setCompleteCost(e.target.value)}
                          className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[14px]"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[12px] font-medium text-[#065F46] mb-1">
                          Notas o resultado post-consulta (opcional)
                        </label>
                        <input
                          type="text"
                          placeholder="Diagnostico, ajuste de dosis o indicaciones"
                          value={completeNotes}
                          onChange={(e) => setCompleteNotes(e.target.value)}
                          className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-[13px] text-[#065F46] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={completeLogExpense}
                          onChange={(e) =>
                            setCompleteLogExpense(e.target.checked)
                          }
                          className="w-4 h-4 accent-[#065F46]"
                        />
                        Registrar pago automaticamente en Bitacora de Gastos
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setCompletingEventId(null)}
                          className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[13px]"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={busyEventId === evt.id}
                          onClick={() => submitComplete(evt)}
                          className="clinical-btn px-4 bg-[#065F46] text-white text-[13px] font-bold"
                        >
                          {busyEventId === evt.id
                            ? "Guardando..."
                            : "Confirmar Cierre"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {rescheduleId === evt.id && (
                  <div className="flex flex-wrap items-end gap-3 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px]">
                    <div>
                      <label
                        htmlFor={`resch-${evt.id}`}
                        className="block text-[13px] font-medium text-[#0F172A] mb-1"
                      >
                        Nueva fecha y hora (confirma fecha y regenera alertas)
                      </label>
                      <input
                        id={`resch-${evt.id}`}
                        type="datetime-local"
                        value={rescheduleDatetime}
                        onChange={(e) => setRescheduleDatetime(e.target.value)}
                        className="h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] bg-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRescheduleSave(evt)}
                      className="clinical-btn px-4 bg-[#0E7490] text-white text-[14px] font-medium"
                    >
                      Actualizar Fecha
                    </button>
                    <button
                      type="button"
                      onClick={() => setRescheduleId(null)}
                      className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-[#475569]">
                    <Repeat
                      className="w-3.5 h-3.5 text-[#0E7490]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span>
                      Linea de recordatorios en cascada (Telegram Bot)
                    </span>
                  </div>
                  <CascadeTimeline alerts={evt.cascade_alerts} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Historial de Eventos Completados */}
      {snapshot.completed_events.length > 0 && (
        <section
          aria-labelledby="completed-events-heading"
          className="space-y-3"
        >
          <h3
            id="completed-events-heading"
            className="text-[16px] font-bold text-[#475569]"
          >
            Eventos Completados ({snapshot.completed_events.length})
          </h3>
          <div className="clinical-card divide-y divide-[#E2E8F0]">
            {snapshot.completed_events.map((evt) => (
              <div
                key={evt.id}
                className="p-3.5 flex flex-wrap items-center justify-between gap-2 bg-white"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge label="[COMPLETADO]" tone="ok" />
                    <span className="font-bold text-[15px] text-[#0F172A]">
                      {evt.title}
                    </span>
                    {evt.actual_cost !== null && (
                      <span className="font-mono text-[13px] font-semibold text-[#0F172A]">
                        ({formatCurrencyMxn(evt.actual_cost)})
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[13px] text-[#475569] tabular-nums">
                    Programado: {formatDateTimeEs(evt.event_datetime)} |
                    Confirmado: {formatDateTimeEs(evt.completed_at)}
                  </p>
                  {evt.notes && (
                    <p className="mt-1 text-[13px] text-[#334155]">
                      Resultado: {evt.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onReopenEvent(evt.id)}
                    className="clinical-btn inline-flex items-center gap-1 px-2.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[13px]"
                  >
                    <RotateCcw
                      className="w-3.5 h-3.5 text-[#0E7490]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    Reabrir
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteEvent(evt.id)}
                    className="clinical-btn px-2.5 border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#991B1B]"
                    aria-label={`Eliminar evento completado ${evt.title}`}
                  >
                    <Trash2
                      className="w-3.5 h-3.5"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
