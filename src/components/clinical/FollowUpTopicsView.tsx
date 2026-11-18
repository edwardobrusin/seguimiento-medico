"use client";

import { useState, type FormEvent } from "react";
import { ClipboardPlus, MessageSquarePlus } from "lucide-react";
import type {
  CommandCenterSnapshot,
  FollowUpTopicItem,
  NoteType,
  TaskStatus,
} from "@/lib/types/clinical";
import {
  NOTE_TYPE_TAG,
  PRIORITY_TAG,
  TASK_STATUS_TAG,
} from "@/lib/clinical-labels";
import { formatCurrencyMxn, formatDateTimeEs } from "@/lib/utils";
import { CascadeTimeline } from "./CascadeTimeline";
import { StatusBadge } from "./StatusBadge";

interface FollowUpTopicsViewProps {
  snapshot: CommandCenterSnapshot;
  onCreateTopic: (payload: {
    title: string;
    description: string;
    priority: number;
    deadline_at: string;
  }) => Promise<void>;
  onUpdateTopic: (
    topicId: string,
    updates: {
      status?: TaskStatus;
      priority?: number;
      progress_percentage?: number;
      deadline_at?: string;
    }
  ) => Promise<void>;
  onAddAnnotation: (payload: {
    topic_id: string;
    author: string;
    note_type: NoteType;
    contact_name: string;
    contact_phone: string;
    estimated_cost: number | null;
    content: string;
  }) => Promise<void>;
}

export function FollowUpTopicsView({
  snapshot,
  onCreateTopic,
  onUpdateTopic,
  onAddAnnotation,
}: FollowUpTopicsViewProps) {
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("1");
  const [deadlineAt, setDeadlineAt] = useState(() => {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [topicError, setTopicError] = useState<string | null>(null);
  const [creatingTopic, setCreatingTopic] = useState(false);

  const [activeNoteTopicId, setActiveNoteTopicId] = useState<string | null>(
    null
  );
  const [author, setAuthor] = useState("Cuidador Principal");
  const [noteType, setNoteType] = useState<NoteType>("PROPOSAL");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  async function handleCreateTopic(e: FormEvent) {
    e.preventDefault();
    setTopicError(null);
    if (!title.trim()) {
      setTopicError("Escribe el titulo del tema de seguimiento.");
      return;
    }
    setCreatingTopic(true);
    try {
      await onCreateTopic({
        title: title.trim(),
        description: description.trim(),
        priority: Number(priority),
        deadline_at: new Date(deadlineAt).toISOString(),
      });
      setTitle("");
      setDescription("");
      setShowTopicForm(false);
    } catch (err) {
      setTopicError(
        err instanceof Error ? err.message : "Error al crear tema."
      );
    } finally {
      setCreatingTopic(false);
    }
  }

  async function handleAddAnnotation(e: FormEvent, topicId: string) {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      const parsedCost =
        estimatedCost.trim() !== "" && Number.isFinite(Number(estimatedCost))
          ? Number(estimatedCost)
          : null;
      await onAddAnnotation({
        topic_id: topicId,
        author: author.trim() || "Cuidador",
        note_type: noteType,
        contact_name: contactName.trim(),
        contact_phone: contactPhone.trim(),
        estimated_cost: parsedCost,
        content: noteContent.trim(),
      });
      setContactName("");
      setContactPhone("");
      setEstimatedCost("");
      setNoteContent("");
      setActiveNoteTopicId(null);
    } finally {
      setSavingNote(false);
    }
  }

  function renderTopicCard(topic: FollowUpTopicItem) {
    const isAddingNote = activeNoteTopicId === topic.id;
    return (
      <article key={topic.id} className="clinical-card p-5 space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E8F0] pb-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                label={PRIORITY_TAG[topic.priority] ?? "[NORMAL]"}
                tone={
                  topic.priority === 1
                    ? "crit"
                    : topic.priority === 2
                    ? "warn"
                    : "neutral"
                }
              />
              <StatusBadge
                label={TASK_STATUS_TAG[topic.status]}
                tone={topic.status === "COMPLETED" ? "ok" : "info"}
              />
            </div>
            <h3 className="text-[18px] font-bold text-[#0F172A]">
              {topic.title}
            </h3>
            {topic.description && (
              <p className="text-[14px] text-[#475569] max-w-[70ch]">
                {topic.description}
              </p>
            )}
            <p className="font-mono text-[13px] text-[#475569] tabular-nums">
              Creacion: {formatDateTimeEs(topic.created_at)} | Fecha limite:{" "}
              <strong className="text-[#0F172A]">
                {formatDateTimeEs(topic.deadline_at)}
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`status-${topic.id}`} className="sr-only">
              Estado de {topic.title}
            </label>
            <select
              id={`status-${topic.id}`}
              value={topic.status}
              onChange={(e) =>
                onUpdateTopic(topic.id, {
                  status: e.target.value as TaskStatus,
                })
              }
              className="h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px] bg-white font-medium"
            >
              <option value="PENDING">Pendiente</option>
              <option value="IN_PROGRESS">En Curso</option>
              <option value="WAITING_RESPONSE">Esperando Respuesta</option>
              <option value="COMPLETED">Completado</option>
            </select>

            <label htmlFor={`progress-${topic.id}`} className="sr-only">
              Progreso de {topic.title}
            </label>
            <select
              id={`progress-${topic.id}`}
              value={String(topic.progress_percentage)}
              onChange={(e) =>
                onUpdateTopic(topic.id, {
                  progress_percentage: Number(e.target.value),
                })
              }
              className="h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] bg-white tabular-nums"
            >
              {[0, 20, 40, 45, 50, 60, 65, 80, 100].map((pct) => (
                <option key={pct} value={pct}>
                  Progreso {pct}%
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() =>
                setActiveNoteTopicId(isAddingNote ? null : topic.id)
              }
              className="clinical-btn inline-flex items-center gap-1.5 px-3.5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
            >
              <MessageSquarePlus
                className="w-4 h-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {isAddingNote ? "Cerrar Nota" : "Agregar Anotacion"}
            </button>
          </div>
        </header>

        {/* Barra de progreso */}
        <div>
          <div className="flex items-center justify-between text-[13px] font-mono text-[#334155] mb-1 tabular-nums">
            <span>Avance de resolucion</span>
            <span className="font-bold">{topic.progress_percentage}%</span>
          </div>
          <div className="h-2 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0E7490]"
              style={{ width: `${topic.progress_percentage}%` }}
            />
          </div>
        </div>

        {/* Recordatorios en cascada */}
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-[#475569]">
            Recordatorios de fecha limite en Telegram (-7d, -3d, -1d, 0d)
          </span>
          <CascadeTimeline alerts={topic.cascade_alerts} />
        </div>

        {/* Formulario inline de anotacion */}
        {isAddingNote && (
          <form
            onSubmit={(e) => handleAddAnnotation(e, topic.id)}
            className="p-4 bg-[#F8FAFC] border border-[#A5F3FC] rounded-[6px] space-y-3"
          >
            <h4 className="text-[15px] font-bold text-[#0F172A]">
              Registrar Propuesta, Contacto o Cotizacion en Bitacora
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label
                  htmlFor={`note-type-${topic.id}`}
                  className="block text-[13px] font-medium text-[#0F172A] mb-1"
                >
                  Tipo de registro
                </label>
                <select
                  id={`note-type-${topic.id}`}
                  value={noteType}
                  onChange={(e) => setNoteType(e.target.value as NoteType)}
                  className="w-full h-[44px] px-2.5 border border-[#CBD5E1] rounded-[6px] text-[14px] bg-white"
                >
                  <option value="PROPOSAL">Propuesta</option>
                  <option value="CONTACT">Contacto / Clinica</option>
                  <option value="QUOTE">Cotizacion / Costo</option>
                  <option value="UPDATE">Actualizacion</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor={`note-author-${topic.id}`}
                  className="block text-[13px] font-medium text-[#0F172A] mb-1"
                >
                  Autor
                </label>
                <input
                  id={`note-author-${topic.id}`}
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full h-[44px] px-2.5 border border-[#CBD5E1] rounded-[6px] text-[14px] bg-white"
                />
              </div>

              <div>
                <label
                  htmlFor={`note-contact-${topic.id}`}
                  className="block text-[13px] font-medium text-[#0F172A] mb-1"
                >
                  Especialista / Clinica
                </label>
                <input
                  id={`note-contact-${topic.id}`}
                  type="text"
                  placeholder="Nombre o institucion"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full h-[44px] px-2.5 border border-[#CBD5E1] rounded-[6px] text-[14px] bg-white"
                />
              </div>

              <div>
                <label
                  htmlFor={`note-phone-${topic.id}`}
                  className="block text-[13px] font-medium text-[#0F172A] mb-1"
                >
                  Telefono
                </label>
                <input
                  id={`note-phone-${topic.id}`}
                  type="text"
                  placeholder="+52 55 ..."
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full h-[44px] px-2.5 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] bg-white"
                />
              </div>

              <div>
                <label
                  htmlFor={`note-cost-${topic.id}`}
                  className="block text-[13px] font-medium text-[#0F172A] mb-1"
                >
                  Costo estimado (MXN)
                </label>
                <input
                  id={`note-cost-${topic.id}`}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                  className="w-full h-[44px] px-2.5 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] bg-white tabular-nums"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor={`note-content-${topic.id}`}
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Detalle y notas de seguimiento
              </label>
              <textarea
                id={`note-content-${topic.id}`}
                rows={2}
                required
                placeholder="Resumen de llamada, condiciones, disponibilidad o acuerdos"
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full p-2.5 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveNoteTopicId(null)}
                className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingNote}
                className="clinical-btn px-4 bg-[#0E7490] text-white text-[14px] font-bold"
              >
                {savingNote ? "Guardando..." : "Guardar en Bitacora"}
              </button>
            </div>
          </form>
        )}

        {/* Bitacora Cronologica */}
        <div className="space-y-2.5">
          <h4 className="text-[14px] font-bold text-[#0F172A]">
            Bitacora Cronologica ({topic.annotations.length})
          </h4>
          {topic.annotations.length === 0 ? (
            <p className="text-[14px] text-[#64748B]">
              Sin anotaciones registradas todavia.
            </p>
          ) : (
            <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-[6px] bg-[#F8FAFC]">
              {topic.annotations.map((ann) => (
                <div key={ann.id} className="p-3.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        label={NOTE_TYPE_TAG[ann.note_type]}
                        tone="info"
                      />
                      {ann.contact_name && (
                        <span className="font-bold text-[14px] text-[#0F172A]">
                          {ann.contact_name}
                        </span>
                      )}
                      {ann.contact_phone && (
                        <span className="font-mono text-[13px] text-[#0E7490] tabular-nums">
                          Tel: {ann.contact_phone}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[13px] tabular-nums">
                      {ann.estimated_cost !== null && (
                        <span className="font-bold text-[#0F172A]">
                          Costo: {formatCurrencyMxn(ann.estimated_cost)}
                        </span>
                      )}
                      <span className="text-[#64748B]">
                        {formatDateTimeEs(ann.created_at)}
                      </span>
                    </div>
                  </div>
                  <p className="text-[14px] text-[#1E293B]">{ann.content}</p>
                  {ann.author && (
                    <p className="text-[13px] text-[#64748B]">
                      Registrado por: {ann.author}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-6 clinical-enter">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-[#0F172A]">
            Gestor de Temas de Seguimiento y Bitacora
          </h2>
          <p className="text-[14px] text-[#475569]">
            Gestion de casos abiertos con fecha limite, alertas en cascada y
            registro de propuestas, telefonos y costos.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowTopicForm((v) => !v)}
          className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
        >
          <ClipboardPlus
            className="w-4 h-4"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {showTopicForm ? "Cerrar Formulario" : "Nuevo Tema de Seguimiento"}
        </button>
      </div>

      {showTopicForm && (
        <form
          onSubmit={handleCreateTopic}
          className="clinical-card p-5 space-y-4 border-[#A5F3FC]"
        >
          <h3 className="text-[16px] font-bold text-[#0F172A]">
            Crear Caso o Pendiente Medico-Administrativo
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label
                htmlFor="topic-title"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Titulo del tema
              </label>
              <input
                id="topic-title"
                type="text"
                required
                placeholder="Ej. Encontrar Terapeuta / Tramitar Reembolso"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
              />
            </div>

            <div>
              <label
                htmlFor="topic-priority"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Prioridad
              </label>
              <select
                id="topic-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px] bg-white"
              >
                <option value="1">1 - Critica</option>
                <option value="2">2 - Alta</option>
                <option value="3">3 - Normal</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="topic-deadline"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Fecha limite (genera alertas -7d/-3d/-1d/0d)
              </label>
              <input
                id="topic-deadline"
                type="datetime-local"
                required
                value={deadlineAt}
                onChange={(e) => setDeadlineAt(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="topic-desc"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Descripcion y objetivos
              </label>
              <input
                id="topic-desc"
                type="text"
                placeholder="Requisitos clinicos, cobertura o documentos necesarios"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
              />
            </div>
          </div>

          {topicError && (
            <p className="text-[14px] font-medium text-[#991B1B]" role="alert">
              {topicError}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowTopicForm(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={creatingTopic}
              className="clinical-btn px-5 bg-[#0E7490] text-white text-[15px] font-bold"
            >
              {creatingTopic ? "Creando..." : "Crear Tema y Programar Alertas"}
            </button>
          </div>
        </form>
      )}

      <section aria-label="Temas abiertos" className="space-y-4">
        <h3 className="text-[16px] font-bold text-[#0F172A]">
          Casos Activos ({snapshot.open_topics.length})
        </h3>
        {snapshot.open_topics.length === 0 ? (
          <div className="clinical-card p-6 text-center text-[#475569]">
            No hay temas abiertos en este momento.
          </div>
        ) : (
          <div className="space-y-4">
            {snapshot.open_topics.map(renderTopicCard)}
          </div>
        )}
      </section>

      {snapshot.completed_topics.length > 0 && (
        <section aria-label="Temas resueltos" className="space-y-4">
          <h3 className="text-[16px] font-bold text-[#475569]">
            Casos Resueltos ({snapshot.completed_topics.length})
          </h3>
          <div className="space-y-4">
            {snapshot.completed_topics.map(renderTopicCard)}
          </div>
        </section>
      )}
    </div>
  );
}
