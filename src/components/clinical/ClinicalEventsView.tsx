"use client";

import { useState, type FormEvent } from "react";
import { CalendarPlus, CheckCircle2, Repeat, Syringe } from "lucide-react";
import type {
  ClinicalEventItem,
  CommandCenterSnapshot,
  EventCategory,
} from "@/lib/types/clinical";
import {
  EVENT_CATEGORY_LABEL,
  EVENT_CATEGORY_TAG,
} from "@/lib/clinical-labels";
import { formatDateTimeEs } from "@/lib/utils";
import { CascadeTimeline } from "./CascadeTimeline";
import { StatusBadge } from "./StatusBadge";

interface ClinicalEventsViewProps {
  snapshot: CommandCenterSnapshot;
  onCreateEvent: (payload: {
    title: string;
    category: EventCategory;
    specialist_or_center: string;
    location_address: string;
    event_datetime: string;
    is_recurring: boolean;
    recurrence_interval_days: number | null;
    medication_id: string | null;
    preparation_instructions: string;
  }) => Promise<void>;
  onCompleteEvent: (eventId: string) => Promise<void>;
  onRescheduleEvent: (eventId: string, newDatetime: string) => Promise<void>;
}

export function ClinicalEventsView({
  snapshot,
  onCreateEvent,
  onCompleteEvent,
  onRescheduleEvent,
}: ClinicalEventsViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EventCategory>("APPOINTMENT");
  const [specialist, setSpecialist] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [eventDatetime, setEventDatetime] = useState(() => {
    const d = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceDays, setRecurrenceDays] = useState("21");
  const [medicationId, setMedicationId] = useState<string>("");
  const [prepInstructions, setPrepInstructions] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDatetime, setRescheduleDatetime] = useState("");
  const [busyEventId, setBusyEventId] = useState<string | null>(null);

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

    setSubmitting(true);
    try {
      await onCreateEvent({
        title: title.trim(),
        category,
        specialist_or_center: specialist.trim(),
        location_address: locationAddress.trim(),
        event_datetime: iso,
        is_recurring: isRecurring,
        recurrence_interval_days: interval,
        medication_id: medicationId || null,
        preparation_instructions: prepInstructions.trim(),
      });
      setTitle("");
      setSpecialist("");
      setLocationAddress("");
      setPrepInstructions("");
      setShowForm(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Error al programar evento."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete(evt: ClinicalEventItem) {
    setBusyEventId(evt.id);
    try {
      await onCompleteEvent(evt.id);
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

  return (
    <div className="space-y-6 clinical-enter">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-[#0F172A]">
            Agenda Clinica y Ciclos Recurrentes
          </h2>
          <p className="text-[14px] text-[#475569]">
            Citas unicas e inyecciones/procedimientos ciclicos con cascada
            automatica de recordatorios (-7d, -3d, -1d, 0d).
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
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

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="clinical-card p-5 space-y-4 border-[#A5F3FC]"
        >
          <h3 className="text-[16px] font-bold text-[#0F172A] border-b border-[#E2E8F0] pb-2.5">
            Nuevo Evento Medico o Ciclo Recurrente
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label
                htmlFor="evt-title"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Titulo del evento
              </label>
              <input
                id="evt-title"
                type="text"
                required
                placeholder="Ej. Cita con Reumatologo / Inyeccion Biologica Cada 3 Semanas"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-category"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Categoria
              </label>
              <select
                id="evt-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as EventCategory)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px] bg-white"
              >
                <option value="APPOINTMENT">Cita Medica</option>
                <option value="INJECTION">Inyeccion</option>
                <option value="LAB_TEST">Estudio de Laboratorio</option>
                <option value="PROCEDURE">Procedimiento</option>
                <option value="OTHER">Otro Evento</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="evt-datetime"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Fecha y hora programada
              </label>
              <input
                id="evt-datetime"
                type="datetime-local"
                required
                value={eventDatetime}
                onChange={(e) => setEventDatetime(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
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
                placeholder="Ej. Dra. Elena Vargas"
                value={specialist}
                onChange={(e) => setSpecialist(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
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
                placeholder="Hospital o domicilio"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
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
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px] bg-white"
              >
                <option value="">Sin descuento de inventario</option>
                {snapshot.medications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (Stock: {m.current_stock} {m.presentation})
                  </option>
                ))}
              </select>
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
                <span className="text-[15px] font-medium text-[#0F172A]">
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
                  className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[16px] tabular-nums"
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
                placeholder="Requisitos de ayuno, estudios previos o cadena de frio"
                value={prepInstructions}
                onChange={(e) => setPrepInstructions(e.target.value)}
                className="w-full p-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
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
              onClick={() => setShowForm(false)}
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
                ? "Programando cascada..."
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
          Eventos Programados ({snapshot.upcoming_events.length})
        </h3>

        {snapshot.upcoming_events.length === 0 ? (
          <div className="clinical-card p-6 text-center text-[#475569]">
            No existen eventos clinicos activos programados.
          </div>
        ) : (
          <div className="space-y-4">
            {snapshot.upcoming_events.map((evt) => (
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
                      {evt.is_recurring && (
                        <StatusBadge
                          label={`[RECURRENTE CADA ${evt.recurrence_interval_days} DIAS]`}
                          tone="warn"
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
                      onClick={() => {
                        setRescheduleId(evt.id);
                        setRescheduleDatetime(
                          new Date(evt.event_datetime)
                            .toISOString()
                            .slice(0, 16)
                        );
                      }}
                      className="clinical-btn px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
                    >
                      Reprogramar
                    </button>

                    <button
                      type="button"
                      disabled={busyEventId === evt.id}
                      onClick={() => handleComplete(evt)}
                      className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
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
                        ? "Confirmar Aplicacion y Renovar Ciclo"
                        : "Confirmar Realizacion"}
                    </button>
                  </div>
                </div>

                {rescheduleId === evt.id && (
                  <div className="flex flex-wrap items-end gap-3 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px]">
                    <div>
                      <label
                        htmlFor={`resch-${evt.id}`}
                        className="block text-[13px] font-medium text-[#0F172A] mb-1"
                      >
                        Nueva fecha y hora (regenera alertas -7d/-3d/-1d/0d)
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

      {/* Historial Reciente de Eventos Completados */}
      {snapshot.completed_events.length > 0 && (
        <section
          aria-labelledby="completed-events-heading"
          className="space-y-3"
        >
          <h3
            id="completed-events-heading"
            className="text-[16px] font-bold text-[#475569]"
          >
            Eventos Completados Recientemente ({snapshot.completed_events.length})
          </h3>
          <div className="clinical-card divide-y divide-[#E2E8F0]">
            {snapshot.completed_events.map((evt) => (
              <div
                key={evt.id}
                className="p-3.5 flex flex-wrap items-center justify-between gap-2 bg-white"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge label="[COMPLETADO]" tone="ok" />
                    <span className="font-bold text-[15px] text-[#0F172A]">
                      {evt.title}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[13px] text-[#475569] tabular-nums">
                    Programado: {formatDateTimeEs(evt.event_datetime)} |
                    Confirmado: {formatDateTimeEs(evt.completed_at)}
                  </p>
                </div>
                {evt.medication_name && (
                  <span className="font-mono text-[13px] text-[#065F46]">
                    Stock descontado: {evt.medication_name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
