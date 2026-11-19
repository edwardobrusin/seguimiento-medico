"use client";

import { useState, type FormEvent } from "react";
import {
  CalendarCheck2,
  ClipboardPlus,
  Edit3,
  MessageSquarePlus,
  Trash2,
} from "lucide-react";
import type {
  CommandCenterSnapshot,
  EventCategory,
  FollowUpTopicItem,
  NoteType,
  TaskStatus,
  TopicAnnotation,
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
    estimated_budget: number | null;
  }) => Promise<void>;
  onUpdateTopic: (
    topicId: string,
    updates: {
      title?: string;
      status?: TaskStatus;
      priority?: number;
      progress_percentage?: number;
      deadline_at?: string;
      description?: string | null;
      estimated_budget?: number | null;
    }
  ) => Promise<void>;
  onDeleteTopic: (topicId: string) => Promise<void>;
  onAddAnnotation: (payload: {
    topic_id: string;
    author: string;
    note_type: NoteType;
    contact_name: string;
    contact_phone: string;
    estimated_cost: number | null;
    content: string;
  }) => Promise<void>;
  onUpdateAnnotation: (
    annotationId: string,
    payload: {
      author: string;
      note_type: NoteType;
      contact_name: string;
      contact_phone: string;
      estimated_cost: number | null;
      content: string;
    }
  ) => Promise<void>;
  onDeleteAnnotation: (annotationId: string) => Promise<void>;
  onConvertToEvent: (payload: {
    topic_id: string;
    title: string;
    category: EventCategory;
    specialist_or_center: string | null;
    location_address: string | null;
    event_datetime: string;
    estimated_cost: number | null;
    preparation_instructions: string | null;
    mark_topic_completed: boolean;
  }) => Promise<void>;
}

export function FollowUpTopicsView({
  snapshot,
  onCreateTopic,
  onUpdateTopic,
  onDeleteTopic,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onConvertToEvent,
}: FollowUpTopicsViewProps) {
  // Crear / Editar tema
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("1");
  const [estimatedBudget, setEstimatedBudget] = useState("");
  const [deadlineAt, setDeadlineAt] = useState(() => {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [topicError, setTopicError] = useState<string | null>(null);
  const [savingTopic, setSavingTopic] = useState(false);

  // Anotaciones (Crear / Editar)
  const [activeNoteTopicId, setActiveNoteTopicId] = useState<string | null>(
    null
  );
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(
    null
  );
  const [author, setAuthor] = useState("Cuidador Principal");
  const [noteType, setNoteType] = useState<NoteType>("PROPOSAL");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Convertir tema en evento clinico
  const [convertingTopicId, setConvertingTopicId] = useState<string | null>(
    null
  );
  const [evtTitle, setEvtTitle] = useState("");
  const [evtCategory, setEvtCategory] = useState<EventCategory>("APPOINTMENT");
  const [evtSpecialist, setEvtSpecialist] = useState("");
  const [evtDatetime, setEvtDatetime] = useState(() => {
    const d = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [evtCost, setEvtCost] = useState("");
  const [evtMarkDone, setEvtMarkDone] = useState(true);
  const [convertingBusy, setConvertingBusy] = useState(false);

  // Confirmaciones de borrado
  const [confirmDeleteTopicId, setConfirmDeleteTopicId] = useState<
    string | null
  >(null);
  const [confirmDeleteAnnId, setConfirmDeleteAnnId] = useState<string | null>(
    null
  );

  function resetTopicForm() {
    setEditingTopicId(null);
    setTitle("");
    setDescription("");
    setPriority("1");
    setEstimatedBudget("");
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    setDeadlineAt(d.toISOString().slice(0, 16));
    setTopicError(null);
  }

  function startEditTopic(topic: FollowUpTopicItem) {
    setEditingTopicId(topic.id);
    setTitle(topic.title);
    setDescription(topic.description ?? "");
    setPriority(String(topic.priority));
    setEstimatedBudget(
      topic.estimated_budget !== null ? String(topic.estimated_budget) : ""
    );
    setDeadlineAt(new Date(topic.deadline_at).toISOString().slice(0, 16));
    setTopicError(null);
    setShowTopicForm(true);
  }

  async function handleSaveTopic(e: FormEvent) {
    e.preventDefault();
    setTopicError(null);
    if (!title.trim()) {
      setTopicError("Escribe el titulo del tema de seguimiento.");
      return;
    }
    const parsedBudget =
      estimatedBudget.trim() !== "" && Number.isFinite(Number(estimatedBudget))
        ? Number(estimatedBudget)
        : null;

    setSavingTopic(true);
    try {
      if (editingTopicId) {
        await onUpdateTopic(editingTopicId, {
          title: title.trim(),
          description: description.trim() || null,
          priority: Number(priority),
          deadline_at: new Date(deadlineAt).toISOString(),
          estimated_budget: parsedBudget,
        });
      } else {
        await onCreateTopic({
          title: title.trim(),
          description: description.trim(),
          priority: Number(priority),
          deadline_at: new Date(deadlineAt).toISOString(),
          estimated_budget: parsedBudget,
        });
      }
      resetTopicForm();
      setShowTopicForm(false);
    } catch (err) {
      setTopicError(
        err instanceof Error ? err.message : "Error al guardar tema."
      );
    } finally {
      setSavingTopic(false);
    }
  }

  function startEditAnnotation(topicId: string, ann: TopicAnnotation) {
    setActiveNoteTopicId(topicId);
    setEditingAnnotationId(ann.id);
    setAuthor(ann.author ?? "Cuidador Principal");
    setNoteType(ann.note_type);
    setContactName(ann.contact_name ?? "");
    setContactPhone(ann.contact_phone ?? "");
    setEstimatedCost(
      ann.estimated_cost !== null ? String(ann.estimated_cost) : ""
    );
    setNoteContent(ann.content);
  }

  function resetAnnotationForm() {
    setEditingAnnotationId(null);
    setContactName("");
    setContactPhone("");
    setEstimatedCost("");
    setNoteContent("");
    setActiveNoteTopicId(null);
  }

  async function handleSaveAnnotation(e: FormEvent, topicId: string) {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      const parsedCost =
        estimatedCost.trim() !== "" && Number.isFinite(Number(estimatedCost))
          ? Number(estimatedCost)
          : null;
      if (editingAnnotationId) {
        await onUpdateAnnotation(editingAnnotationId, {
          author: author.trim() || "Cuidador",
          note_type: noteType,
          contact_name: contactName.trim(),
          contact_phone: contactPhone.trim(),
          estimated_cost: parsedCost,
          content: noteContent.trim(),
        });
      } else {
        await onAddAnnotation({
          topic_id: topicId,
          author: author.trim() || "Cuidador",
          note_type: noteType,
          contact_name: contactName.trim(),
          contact_phone: contactPhone.trim(),
          estimated_cost: parsedCost,
          content: noteContent.trim(),
        });
      }
      resetAnnotationForm();
    } finally {
      setSavingNote(false);
    }
  }

  function startConvertToEvent(topic: FollowUpTopicItem) {
    setConvertingTopicId(topic.id);
    setEvtTitle(topic.title.replace(/^Valorar\s+/i, ""));
    setEvtCategory("APPOINTMENT");
    setEvtSpecialist("");
    setEvtCost(
      topic.estimated_budget !== null ? String(topic.estimated_budget) : ""
    );
    setEvtMarkDone(true);
  }

  async function handleConvertSubmit(e: FormEvent, topic: FollowUpTopicItem) {
    e.preventDefault();
    if (!evtTitle.trim()) return;
    setConvertingBusy(true);
    try {
      const parsedCost =
        evtCost.trim() !== "" && Number.isFinite(Number(evtCost))
          ? Number(evtCost)
          : null;
      await onConvertToEvent({
        topic_id: topic.id,
        title: evtTitle.trim(),
        category: evtCategory,
        specialist_or_center: evtSpecialist.trim() || null,
        location_address: null,
        event_datetime: new Date(evtDatetime).toISOString(),
        estimated_cost: parsedCost,
        preparation_instructions: topic.description,
        mark_topic_completed: evtMarkDone,
      });
      setConvertingTopicId(null);
    } finally {
      setConvertingBusy(false);
    }
  }

  function renderTopicCard(topic: FollowUpTopicItem) {
    const isAddingNote = activeNoteTopicId === topic.id;
    const isConverting = convertingTopicId === topic.id;
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
              {topic.estimated_budget !== null && (
                <StatusBadge
                  label={`PRESUPUESTO: ${formatCurrencyMxn(
                    topic.estimated_budget
                  )}`}
                  tone="ok"
                />
              )}
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
              {[0, 10, 20, 25, 40, 50, 60, 75, 80, 90, 100].map((pct) => (
                <option key={pct} value={pct}>
                  Progreso {pct}%
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => startEditTopic(topic)}
              className="clinical-btn inline-flex items-center gap-1 px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px] font-medium"
            >
              <Edit3 className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" />
              Editar
            </button>

            <button
              type="button"
              onClick={() =>
                isConverting
                  ? setConvertingTopicId(null)
                  : startConvertToEvent(topic)
              }
              className="clinical-btn inline-flex items-center gap-1 px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0E7490] text-[13px] font-medium"
              title="Convertir tema en una cita o estudio en Agenda Clinica"
            >
              <CalendarCheck2
                className="w-3.5 h-3.5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              Agendar Cita
            </button>

            <button
              type="button"
              onClick={() => {
                if (isAddingNote) {
                  resetAnnotationForm();
                } else {
                  setEditingAnnotationId(null);
                  setNoteContent("");
                  setActiveNoteTopicId(topic.id);
                }
              }}
              className="clinical-btn inline-flex items-center gap-1.5 px-3.5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[13px] font-bold"
            >
              <MessageSquarePlus
                className="w-4 h-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {isAddingNote ? "Cerrar Nota" : "Agregar Anotacion"}
            </button>

            {confirmDeleteTopicId === topic.id ? (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    await onDeleteTopic(topic.id);
                    setConfirmDeleteTopicId(null);
                  }}
                  className="clinical-btn px-3 bg-[#991B1B] text-white text-[13px] font-bold"
                >
                  Confirmar Borrar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteTopicId(null)}
                  className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white text-[13px]"
                >
                  No
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDeleteTopicId(topic.id)}
                className="clinical-btn px-2.5 border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#991B1B]"
                aria-label={`Eliminar tema ${topic.title}`}
              >
                <Trash2
                  className="w-4 h-4"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
            )}
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

        {/* Convertir tema en evento clinico */}
        {isConverting && (
          <form
            onSubmit={(e) => handleConvertSubmit(e, topic)}
            className="p-4 bg-[#ECFEFF] border border-[#A5F3FC] rounded-[6px] space-y-3"
          >
            <h4 className="text-[15px] font-bold text-[#164E63]">
              Agendar en Agenda Clinica desde este Tema
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[12px] font-medium text-[#0F172A] mb-1">
                  Titulo de la cita / estudio *
                </label>
                <input
                  type="text"
                  required
                  value={evtTitle}
                  onChange={(e) => setEvtTitle(e.target.value)}
                  className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#0F172A] mb-1">
                  Categoria
                </label>
                <select
                  value={evtCategory}
                  onChange={(e) =>
                    setEvtCategory(e.target.value as EventCategory)
                  }
                  className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
                >
                  <option value="APPOINTMENT">Cita Medica</option>
                  <option value="LAB_TEST">Estudio / Lab</option>
                  <option value="PROCEDURE">Procedimiento</option>
                  <option value="OTHER">Otro</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#0F172A] mb-1">
                  Costo estimado MXN
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={evtCost}
                  onChange={(e) => setEvtCost(e.target.value)}
                  className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[14px]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[12px] font-medium text-[#0F172A] mb-1">
                  Fecha y hora
                </label>
                <input
                  type="datetime-local"
                  required
                  value={evtDatetime}
                  onChange={(e) => setEvtDatetime(e.target.value)}
                  className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] bg-white font-mono text-[14px]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[12px] font-medium text-[#0F172A] mb-1">
                  Especialista o centro
                </label>
                <input
                  type="text"
                  value={evtSpecialist}
                  onChange={(e) => setEvtSpecialist(e.target.value)}
                  className="w-full h-[42px] px-2.5 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-[13px] text-[#164E63] cursor-pointer">
                <input
                  type="checkbox"
                  checked={evtMarkDone}
                  onChange={(e) => setEvtMarkDone(e.target.checked)}
                  className="w-4 h-4 accent-[#0E7490]"
                />
                Marcar tema de seguimiento como COMPLETADO al agendar
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConvertingTopicId(null)}
                  className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[13px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={convertingBusy}
                  className="clinical-btn px-4 bg-[#0E7490] text-white text-[13px] font-bold"
                >
                  {convertingBusy ? "Agendando..." : "Crear Evento en Agenda"}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Formulario inline de anotacion (crear / editar) */}
        {isAddingNote && (
          <form
            onSubmit={(e) => handleSaveAnnotation(e, topic.id)}
            className="p-4 bg-[#F8FAFC] border border-[#A5F3FC] rounded-[6px] space-y-3"
          >
            <h4 className="text-[15px] font-bold text-[#0F172A]">
              {editingAnnotationId
                ? "Editar Anotacion en Bitacora"
                : "Registrar Propuesta, Contacto o Cotizacion en Bitacora"}
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
                onClick={resetAnnotationForm}
                className="clinical-btn px-3 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingNote}
                className="clinical-btn px-4 bg-[#0E7490] text-white text-[14px] font-bold"
              >
                {savingNote
                  ? "Guardando..."
                  : editingAnnotationId
                  ? "Actualizar Anotacion"
                  : "Guardar en Bitacora"}
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
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[13px] tabular-nums">
                      {ann.estimated_cost !== null && (
                        <span className="font-bold text-[#0F172A]">
                          Costo: {formatCurrencyMxn(ann.estimated_cost)}
                        </span>
                      )}
                      <span className="text-[#64748B]">
                        {formatDateTimeEs(ann.created_at)}
                      </span>
                      <button
                        type="button"
                        onClick={() => startEditAnnotation(topic.id, ann)}
                        className="px-2 py-1 border border-[#CBD5E1] bg-white rounded-[4px] text-[12px] font-sans"
                      >
                        Editar
                      </button>
                      {confirmDeleteAnnId === ann.id ? (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteAnnotation(ann.id);
                              setConfirmDeleteAnnId(null);
                            }}
                            className="px-2 py-1 bg-[#991B1B] text-white rounded-[4px] text-[12px] font-sans font-bold"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteAnnId(null)}
                            className="px-2 py-1 border border-[#CBD5E1] bg-white rounded-[4px] text-[12px] font-sans"
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAnnId(ann.id)}
                          className="px-2 py-1 border border-[#FECACA] bg-white text-[#991B1B] rounded-[4px] text-[12px] font-sans"
                        >
                          Borrar
                        </button>
                      )}
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
            Gestor de Temas de Seguimiento y Valoraciones
          </h2>
          <p className="text-[14px] text-[#475569]">
            Casos abiertos, cotizaciones, contactos, conversion a cita medica y
            gobernanza completa de bitacora.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (showTopicForm && !editingTopicId) {
              setShowTopicForm(false);
            } else {
              resetTopicForm();
              setShowTopicForm(true);
            }
          }}
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
          onSubmit={handleSaveTopic}
          className="clinical-card p-5 space-y-4 border-[#A5F3FC]"
        >
          <h3 className="text-[16px] font-bold text-[#0F172A]">
            {editingTopicId
              ? `Editar Tema: ${title}`
              : "Crear Caso o Pendiente Medico-Administrativo"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label
                htmlFor="topic-title"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Titulo del tema *
              </label>
              <input
                id="topic-title"
                type="text"
                required
                placeholder="Ej. Valorar Consulta Psiquiatria CDMX"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
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
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
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
                Fecha limite (alertas -7d/-3d/-1d/0d)
              </label>
              <input
                id="topic-deadline"
                type="datetime-local"
                required
                value={deadlineAt}
                onChange={(e) => setDeadlineAt(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="topic-budget"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Presupuesto de referencia (MXN opc.)
              </label>
              <input
                id="topic-budget"
                type="number"
                step="0.01"
                min="0"
                placeholder="Ej. 3000"
                value={estimatedBudget}
                onChange={(e) => setEstimatedBudget(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px]"
              />
            </div>

            <div>
              <label
                htmlFor="topic-desc"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Descripcion y objetivos
              </label>
              <input
                id="topic-desc"
                type="text"
                placeholder="Requisitos, ubicacion o documentos"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
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
              onClick={() => {
                setShowTopicForm(false);
                resetTopicForm();
              }}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingTopic}
              className="clinical-btn px-5 bg-[#0E7490] text-white text-[15px] font-bold"
            >
              {savingTopic
                ? "Guardando..."
                : editingTopicId
                ? "Guardar Cambios"
                : "Crear Tema y Programar Alertas"}
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
