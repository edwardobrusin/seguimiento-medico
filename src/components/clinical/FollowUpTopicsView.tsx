"use client";

import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  CalendarPlus,
  Check,
  Edit3,
  MessageSquarePlus,
  Plus,
  RotateCcw,
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
  EVENT_CATEGORY_LABEL,
  NOTE_TYPE_TAG,
  PRIORITY_TAG,
  TASK_STATUS_LABEL,
  TASK_STATUS_TAG,
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

interface FollowUpTopicsViewProps {
  snapshot: CommandCenterSnapshot;
  isAdmin: boolean;
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

const PROGRESS_PRESETS = [0, 10, 20, 25, 40, 50, 60, 75, 80, 90, 100];
const STATUS_OPTIONS: TaskStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "WAITING_RESPONSE",
  "COMPLETED",
];
const NOTE_TYPES: NoteType[] = ["PROPOSAL", "CONTACT", "UPDATE", "QUOTE"];

function parseOptionalNonNeg(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function progressOptionsFor(current: number): number[] {
  const set = new Set<number>(PROGRESS_PRESETS);
  if (Number.isFinite(current)) set.add(Math.round(current));
  return Array.from(set).sort((a, b) => a - b);
}

export function FollowUpTopicsView({
  snapshot,
  isAdmin,
  onCreateTopic,
  onUpdateTopic,
  onDeleteTopic,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onConvertToEvent,
}: FollowUpTopicsViewProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  // Topic modal
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<FollowUpTopicItem | null>(
    null
  );
  const [topicTitle, setTopicTitle] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [topicPriority, setTopicPriority] = useState("2");
  const [topicDeadline, setTopicDeadline] = useState("");
  const [topicBudget, setTopicBudget] = useState("");
  const [topicError, setTopicError] = useState<string | null>(null);
  const [savingTopic, setSavingTopic] = useState(false);

  // Annotation modal
  const [annTopic, setAnnTopic] = useState<FollowUpTopicItem | null>(null);
  const [editingAnn, setEditingAnn] = useState<TopicAnnotation | null>(null);
  const [annAuthor, setAnnAuthor] = useState("");
  const [annType, setAnnType] = useState<NoteType>("UPDATE");
  const [annContactName, setAnnContactName] = useState("");
  const [annContactPhone, setAnnContactPhone] = useState("");
  const [annCost, setAnnCost] = useState("");
  const [annContent, setAnnContent] = useState("");
  const [annError, setAnnError] = useState<string | null>(null);
  const [savingAnn, setSavingAnn] = useState(false);

  // Convert modal
  const [convertTopic, setConvertTopic] = useState<FollowUpTopicItem | null>(
    null
  );
  const [cvTitle, setCvTitle] = useState("");
  const [cvCategory, setCvCategory] = useState<EventCategory>("APPOINTMENT");
  const [cvSpecialist, setCvSpecialist] = useState("");
  const [cvLocation, setCvLocation] = useState("");
  const [cvDatetime, setCvDatetime] = useState("");
  const [cvCost, setCvCost] = useState("");
  const [cvPrep, setCvPrep] = useState("");
  const [cvMarkCompleted, setCvMarkCompleted] = useState(true);
  const [cvError, setCvError] = useState<string | null>(null);
  const [savingCv, setSavingCv] = useState(false);

  async function runBusy(key: string, fn: () => Promise<void>) {
    setBusyKey(key);
    try {
      await fn();
    } catch {
      // El toast global de ClinicalShell muestra el error
    } finally {
      setBusyKey(null);
    }
  }

  function openCreateTopic() {
    setEditingTopic(null);
    setTopicTitle("");
    setTopicDescription("");
    setTopicPriority("2");
    setTopicDeadline(
      toLocalDateTimeInput(new Date(Date.now() + 14 * 86400000).toISOString())
    );
    setTopicBudget("");
    setTopicError(null);
    setTopicModalOpen(true);
  }

  function openEditTopic(topic: FollowUpTopicItem) {
    setEditingTopic(topic);
    setTopicTitle(topic.title);
    setTopicDescription(topic.description ?? "");
    setTopicPriority(String(topic.priority));
    setTopicDeadline(toLocalDateTimeInput(topic.deadline_at));
    setTopicBudget(
      topic.estimated_budget === null ? "" : String(topic.estimated_budget)
    );
    setTopicError(null);
    setTopicModalOpen(true);
  }

  async function handleTopicSubmit(e: FormEvent) {
    e.preventDefault();
    setTopicError(null);
    if (!topicTitle.trim()) {
      setTopicError("Ingresa el titulo del tema.");
      return;
    }
    const deadline = new Date(topicDeadline);
    if (Number.isNaN(deadline.getTime())) {
      setTopicError("Selecciona una fecha limite valida.");
      return;
    }
    const priority = Math.max(
      1,
      Math.min(3, Number.parseInt(topicPriority, 10) || 2)
    );
    const budget = parseOptionalNonNeg(topicBudget);

    setSavingTopic(true);
    try {
      if (editingTopic) {
        await onUpdateTopic(editingTopic.id, {
          title: topicTitle.trim(),
          description: topicDescription.trim() || null,
          priority,
          deadline_at: deadline.toISOString(),
          estimated_budget: budget,
        });
      } else {
        await onCreateTopic({
          title: topicTitle.trim(),
          description: topicDescription.trim(),
          priority,
          deadline_at: deadline.toISOString(),
          estimated_budget: budget,
        });
      }
      setTopicModalOpen(false);
    } catch (err) {
      setTopicError(
        err instanceof Error ? err.message : "No se pudo guardar el tema."
      );
    } finally {
      setSavingTopic(false);
    }
  }

  function openAddAnnotation(topic: FollowUpTopicItem) {
    setAnnTopic(topic);
    setEditingAnn(null);
    setAnnAuthor("");
    setAnnType("UPDATE");
    setAnnContactName("");
    setAnnContactPhone("");
    setAnnCost("");
    setAnnContent("");
    setAnnError(null);
  }

  function openEditAnnotation(topic: FollowUpTopicItem, ann: TopicAnnotation) {
    setAnnTopic(topic);
    setEditingAnn(ann);
    setAnnAuthor(ann.author ?? "");
    setAnnType(ann.note_type);
    setAnnContactName(ann.contact_name ?? "");
    setAnnContactPhone(ann.contact_phone ?? "");
    setAnnCost(ann.estimated_cost === null ? "" : String(ann.estimated_cost));
    setAnnContent(ann.content);
    setAnnError(null);
  }

  async function handleAnnotationSubmit(e: FormEvent) {
    e.preventDefault();
    if (!annTopic) return;
    setAnnError(null);
    if (!annContent.trim()) {
      setAnnError("Escribe el contenido de la anotacion.");
      return;
    }
    const payload = {
      author: annAuthor.trim(),
      note_type: annType,
      contact_name: annContactName.trim(),
      contact_phone: annContactPhone.trim(),
      estimated_cost: parseOptionalNonNeg(annCost),
      content: annContent.trim(),
    };
    setSavingAnn(true);
    try {
      if (editingAnn) {
        await onUpdateAnnotation(editingAnn.id, payload);
      } else {
        await onAddAnnotation({ topic_id: annTopic.id, ...payload });
      }
      setAnnTopic(null);
      setEditingAnn(null);
    } catch (err) {
      setAnnError(
        err instanceof Error ? err.message : "No se pudo guardar la anotacion."
      );
    } finally {
      setSavingAnn(false);
    }
  }

  function openConvert(topic: FollowUpTopicItem) {
    setConvertTopic(topic);
    setCvTitle(topic.title);
    setCvCategory("APPOINTMENT");
    setCvSpecialist("");
    setCvLocation("");
    setCvDatetime(toLocalDateTimeInput(topic.deadline_at));
    setCvCost(
      topic.estimated_budget === null ? "" : String(topic.estimated_budget)
    );
    setCvPrep("");
    setCvMarkCompleted(true);
    setCvError(null);
  }

  async function handleConvertSubmit(e: FormEvent) {
    e.preventDefault();
    if (!convertTopic) return;
    setCvError(null);
    if (!cvTitle.trim()) {
      setCvError("Ingresa el titulo del evento.");
      return;
    }
    const dt = new Date(cvDatetime);
    if (Number.isNaN(dt.getTime())) {
      setCvError("Selecciona una fecha y hora validas.");
      return;
    }
    setSavingCv(true);
    try {
      await onConvertToEvent({
        topic_id: convertTopic.id,
        title: cvTitle.trim(),
        category: cvCategory,
        specialist_or_center: cvSpecialist.trim() || null,
        location_address: cvLocation.trim() || null,
        event_datetime: dt.toISOString(),
        estimated_cost: parseOptionalNonNeg(cvCost),
        preparation_instructions: cvPrep.trim() || null,
        mark_topic_completed: cvMarkCompleted,
      });
      setConvertTopic(null);
    } catch (err) {
      setCvError(
        err instanceof Error ? err.message : "No se pudo agendar el evento."
      );
    } finally {
      setSavingCv(false);
    }
  }

  function renderDeleteControl(
    key: string,
    label: string,
    onConfirm: () => Promise<void>
  ) {
    if (!isAdmin) return null;
    if (confirmDeleteKey === key) {
      return (
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            disabled={busyKey === key}
            onClick={() =>
              runBusy(key, async () => {
                await onConfirm();
                setConfirmDeleteKey(null);
              })
            }
            className="clinical-btn px-3 bg-[#991B1B] text-white text-[12px] font-bold"
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeleteKey(null)}
            className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white text-[#334155] text-[12px]"
          >
            No
          </button>
        </div>
      );
    }
    return (
      <IconActionButton
        icon={Trash2}
        label={label}
        tone="danger"
        onClick={() => setConfirmDeleteKey(key)}
      />
    );
  }

  function renderTopic(topic: FollowUpTopicItem) {
    const daysLeft = getDaysUntil(topic.deadline_at);
    const isCompleted = topic.status === "COMPLETED";
    const overdue = !isCompleted && daysLeft < 0;

    return (
      <article
        key={topic.id}
        className={cn(
          "clinical-card p-5 space-y-3",
          overdue && "border-[#FECACA] bg-[#FEF2F2]/35"
        )}
      >
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                label={PRIORITY_TAG[topic.priority] ?? "[PRIORIDAD]"}
                tone={topic.priority === 1 ? "crit" : topic.priority === 2 ? "warn" : "neutral"}
              />
              <StatusBadge
                label={TASK_STATUS_TAG[topic.status]}
                tone={isCompleted ? "ok" : "info"}
              />
              {!isCompleted && (
                <StatusBadge
                  label={
                    overdue
                      ? `[VENCIDO HACE ${Math.abs(daysLeft)}D]`
                      : daysLeft === 0
                      ? "[VENCE HOY]"
                      : `[FALTAN ${daysLeft}D]`
                  }
                  tone={overdue || daysLeft <= 1 ? "crit" : daysLeft <= 7 ? "warn" : "neutral"}
                />
              )}
            </div>

            <h3 className="text-[17px] font-bold text-[#0F172A]">
              {topic.title}
            </h3>
            {topic.description && (
              <p className="text-[14px] text-[#334155]">{topic.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-[#475569]">
              <span>
                Fecha limite:{" "}
                <strong className="font-mono text-[#0F172A] tabular-nums">
                  {formatDateTimeEs(topic.deadline_at)}
                </strong>
              </span>
              {topic.estimated_budget !== null && (
                <span>
                  Presupuesto:{" "}
                  <strong className="font-mono text-[#0F172A] tabular-nums">
                    {formatCurrencyMxn(topic.estimated_budget)}
                  </strong>
                </span>
              )}
            </div>

            {/* Estado y avance inline */}
            {!isCompleted && (
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <div>
                  <label
                    htmlFor={`topic-status-${topic.id}`}
                    className="block text-[12px] text-[#475569] mb-1"
                  >
                    Estado
                  </label>
                  <select
                    id={`topic-status-${topic.id}`}
                    value={topic.status}
                    disabled={busyKey === `status:${topic.id}`}
                    onChange={(e) =>
                      runBusy(`status:${topic.id}`, () =>
                        onUpdateTopic(topic.id, {
                          status: e.target.value as TaskStatus,
                        })
                      )
                    }
                    className="clinical-input border border-[#CBD5E1] px-3 text-[13px] bg-white"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {TASK_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`topic-progress-${topic.id}`}
                    className="block text-[12px] text-[#475569] mb-1"
                  >
                    Avance
                  </label>
                  <select
                    id={`topic-progress-${topic.id}`}
                    value={Math.round(topic.progress_percentage)}
                    disabled={busyKey === `progress:${topic.id}`}
                    onChange={(e) =>
                      runBusy(`progress:${topic.id}`, () =>
                        onUpdateTopic(topic.id, {
                          progress_percentage: Number(e.target.value),
                        })
                      )
                    }
                    className="clinical-input border border-[#CBD5E1] px-3 font-mono text-[13px] bg-white"
                  >
                    {progressOptionsFor(topic.progress_percentage).map((p) => (
                      <option key={p} value={p}>
                        {p}%
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex-1 min-w-[140px] pb-3">
                  <div
                    className="h-2 rounded-full bg-[#E2E8F0] overflow-hidden"
                    role="progressbar"
                    aria-valuenow={topic.progress_percentage}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Avance de ${topic.title}`}
                  >
                    <div
                      className="h-full bg-[#0E7490]"
                      style={{ width: `${Math.min(100, Math.max(0, topic.progress_percentage))}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {!isCompleted && topic.cascade_alerts.length > 0 && (
              <div className="pt-1">
                <p className="text-[12px] font-semibold text-[#475569] mb-1">
                  {isAdmin
                    ? "Recordatorios de fecha limite en Telegram (-7d, -3d, -1d, 0d)"
                    : "Recordatorios programados (-7d, -3d, -1d, 0d)"}
                </p>
                <CascadeTimeline alerts={topic.cascade_alerts} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isCompleted ? (
              <IconActionButton
                icon={RotateCcw}
                label={`Reabrir tema ${topic.title}`}
                tone="info"
                loading={busyKey === `reopen:${topic.id}`}
                onClick={() =>
                  runBusy(`reopen:${topic.id}`, () =>
                    onUpdateTopic(topic.id, { status: "IN_PROGRESS" })
                  )
                }
              />
            ) : (
              <>
                <IconActionButton
                  icon={Check}
                  label={`Marcar tema como completado: ${topic.title}`}
                  tone="success"
                  loading={busyKey === `done:${topic.id}`}
                  onClick={() =>
                    runBusy(`done:${topic.id}`, () =>
                      onUpdateTopic(topic.id, {
                        status: "COMPLETED",
                        progress_percentage: 100,
                      })
                    )
                  }
                />
                <IconActionButton
                  icon={CalendarPlus}
                  label={`Convertir en cita de la agenda: ${topic.title}`}
                  tone="info"
                  onClick={() => openConvert(topic)}
                />
              </>
            )}
            <IconActionButton
              icon={MessageSquarePlus}
              label={`Agregar anotacion a ${topic.title}`}
              tone="neutral"
              onClick={() => openAddAnnotation(topic)}
            />
            <IconActionButton
              icon={Edit3}
              label={`Editar tema ${topic.title}`}
              tone="neutral"
              onClick={() => openEditTopic(topic)}
            />
            {renderDeleteControl(
              `topic:${topic.id}`,
              `Eliminar tema ${topic.title}`,
              () => onDeleteTopic(topic.id)
            )}
          </div>
        </div>

        {/* Bitacora de anotaciones */}
        {topic.annotations.length > 0 && (
          <div className="pt-3 border-t border-[#E2E8F0] space-y-2">
            <p className="text-[12px] font-semibold text-[#475569]">
              Bitacora ({topic.annotations.length})
            </p>
            {topic.annotations.map((ann) => (
              <div
                key={ann.id}
                className="p-3 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0] flex flex-wrap items-start justify-between gap-3"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#475569]">
                    <StatusBadge label={NOTE_TYPE_TAG[ann.note_type]} tone="neutral" />
                    <span className="font-mono tabular-nums">
                      {formatDateTimeEs(ann.created_at)}
                    </span>
                    {ann.author && <span>por {ann.author}</span>}
                  </div>
                  <p className="text-[14px] text-[#0F172A] whitespace-pre-wrap break-words">
                    {ann.content}
                  </p>
                  {(ann.contact_name || ann.contact_phone || ann.estimated_cost !== null) && (
                    <p className="text-[12px] text-[#475569]">
                      {ann.contact_name ? `Contacto: ${ann.contact_name} ` : ""}
                      {ann.contact_phone ? `| Tel: ${ann.contact_phone} ` : ""}
                      {ann.estimated_cost !== null
                        ? `| Costo: ${formatCurrencyMxn(ann.estimated_cost)}`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <IconActionButton
                    icon={Edit3}
                    label="Editar anotacion"
                    tone="neutral"
                    onClick={() => openEditAnnotation(topic, ann)}
                  />
                  {renderDeleteControl(
                    `ann:${ann.id}`,
                    "Eliminar anotacion",
                    () => onDeleteAnnotation(ann.id)
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="space-y-5 clinical-enter">
      <section className="clinical-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-[#0F172A]">
              Temas de Seguimiento y Pendientes Medicos
            </h2>
            <p className="mt-1 text-[14px] text-[#475569]">
              Tramites, cotizaciones, segundas opiniones y pendientes con fecha
              limite, avance y bitacora de contactos.
            </p>
          </div>
          <IconActionButton
            icon={Plus}
            label="Crear nuevo tema de seguimiento"
            shortLabel="Nuevo Tema"
            tone="primary"
            onClick={openCreateTopic}
          />
        </div>

        <div
          aria-label="Guia visual de acciones"
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 rounded-[6px] w-fit"
        >
          <span className="font-semibold text-[#0F172A]">Simbolos:</span>
          <span className="inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5 text-[#065F46]" aria-hidden="true" />
            Completar
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarPlus className="w-3.5 h-3.5 text-[#0E7490]" aria-hidden="true" />
            Convertir en cita
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquarePlus className="w-3.5 h-3.5 text-[#334155]" aria-hidden="true" />
            Anotar
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
      </section>

      <section aria-label="Temas abiertos" className="space-y-3">
        {snapshot.open_topics.length === 0 ? (
          <div className="clinical-card p-8 text-center text-[14px] text-[#475569]">
            No hay temas de seguimiento abiertos.
          </div>
        ) : (
          snapshot.open_topics.map(renderTopic)
        )}
      </section>

      {snapshot.completed_topics.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-[#0F172A]">
              Temas Completados ({snapshot.completed_topics.length})
            </h3>
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className="text-[13px] font-semibold text-[#0E7490] hover:underline cursor-pointer"
            >
              {showCompleted ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {showCompleted && snapshot.completed_topics.map(renderTopic)}
        </section>
      )}

      {/* Modal Tema */}
      <ClinicalModal
        open={topicModalOpen}
        onClose={() => !savingTopic && setTopicModalOpen(false)}
        title={editingTopic ? `Editar Tema: ${editingTopic.title}` : "Nuevo Tema de Seguimiento"}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleTopicSubmit} className="space-y-4">
          {topicError && (
            <div role="alert" className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{topicError}</span>
            </div>
          )}
          <div>
            <label htmlFor="topic-title" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
              Titulo *
            </label>
            <input
              id="topic-title"
              type="text"
              required
              value={topicTitle}
              onChange={(e) => setTopicTitle(e.target.value)}
              className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
            />
          </div>
          <div>
            <label htmlFor="topic-desc" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
              Descripcion
            </label>
            <textarea
              id="topic-desc"
              rows={3}
              value={topicDescription}
              onChange={(e) => setTopicDescription(e.target.value)}
              className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="topic-priority" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Prioridad
              </label>
              <select
                id="topic-priority"
                value={topicPriority}
                onChange={(e) => setTopicPriority(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
              >
                <option value="1">1 - Critica</option>
                <option value="2">2 - Alta</option>
                <option value="3">3 - Normal</option>
              </select>
            </div>
            <div>
              <label htmlFor="topic-deadline" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Fecha limite *
              </label>
              <input
                id="topic-deadline"
                type="datetime-local"
                required
                value={topicDeadline}
                onChange={(e) => setTopicDeadline(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
            <div>
              <label htmlFor="topic-budget" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Presupuesto (MXN)
              </label>
              <input
                id="topic-budget"
                type="number"
                step="0.01"
                min="0"
                value={topicBudget}
                onChange={(e) => setTopicBudget(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button type="button" onClick={() => setTopicModalOpen(false)} className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]">
              Cancelar
            </button>
            <button type="submit" disabled={savingTopic} className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold">
              {savingTopic ? "Guardando..." : editingTopic ? "Guardar Cambios" : "Crear Tema"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal Anotacion */}
      <ClinicalModal
        open={Boolean(annTopic)}
        onClose={() => {
          if (!savingAnn) {
            setAnnTopic(null);
            setEditingAnn(null);
          }
        }}
        title={editingAnn ? "Editar Anotacion" : `Nueva Anotacion: ${annTopic?.title ?? ""}`}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleAnnotationSubmit} className="space-y-4">
          {annError && (
            <div role="alert" className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]">
              {annError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="ann-type" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Tipo
              </label>
              <select
                id="ann-type"
                value={annType}
                onChange={(e) => setAnnType(e.target.value as NoteType)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
              >
                {NOTE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {NOTE_TYPE_TAG[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ann-author" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Autor
              </label>
              <input id="ann-author" type="text" value={annAuthor} onChange={(e) => setAnnAuthor(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="ann-contact" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Nombre de contacto
              </label>
              <input id="ann-contact" type="text" value={annContactName} onChange={(e) => setAnnContactName(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="ann-phone" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Telefono
              </label>
              <input id="ann-phone" type="tel" value={annContactPhone} onChange={(e) => setAnnContactPhone(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="ann-cost" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Costo cotizado (MXN)
              </label>
              <input id="ann-cost" type="number" step="0.01" min="0" value={annCost} onChange={(e) => setAnnCost(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
          </div>
          <div>
            <label htmlFor="ann-content" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
              Contenido *
            </label>
            <textarea id="ann-content" rows={3} required value={annContent} onChange={(e) => setAnnContent(e.target.value)} className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button type="button" onClick={() => { setAnnTopic(null); setEditingAnn(null); }} className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]">
              Cancelar
            </button>
            <button type="submit" disabled={savingAnn} className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold">
              {savingAnn ? "Guardando..." : "Guardar Anotacion"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal Convertir a Evento */}
      <ClinicalModal
        open={Boolean(convertTopic)}
        onClose={() => !savingCv && setConvertTopic(null)}
        title={`Agendar en Agenda Clinica: ${convertTopic?.title ?? ""}`}
        subtitle="Crea una cita formal con recordatorios a partir de este tema."
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleConvertSubmit} className="space-y-4">
          {cvError && (
            <div role="alert" className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]">
              {cvError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label htmlFor="cv-title" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Titulo *
              </label>
              <input id="cv-title" type="text" required value={cvTitle} onChange={(e) => setCvTitle(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="cv-category" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Categoria
              </label>
              <select id="cv-category" value={cvCategory} onChange={(e) => setCvCategory(e.target.value as EventCategory)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white">
                {(["APPOINTMENT", "INJECTION", "LAB_TEST", "PROCEDURE", "OTHER"] as EventCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {EVENT_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cv-datetime" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Fecha y hora local *
              </label>
              <input id="cv-datetime" type="datetime-local" required value={cvDatetime} onChange={(e) => setCvDatetime(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
            <div>
              <label htmlFor="cv-specialist" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Especialista / Clinica
              </label>
              <input id="cv-specialist" type="text" value={cvSpecialist} onChange={(e) => setCvSpecialist(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="cv-location" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Direccion
              </label>
              <input id="cv-location" type="text" value={cvLocation} onChange={(e) => setCvLocation(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="cv-cost" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
                Costo estimado (MXN)
              </label>
              <input id="cv-cost" type="number" step="0.01" min="0" value={cvCost} onChange={(e) => setCvCost(e.target.value)} className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]" />
            </div>
          </div>
          <div>
            <label htmlFor="cv-prep" className="block text-[13px] font-semibold text-[#0F172A] mb-1">
              Instrucciones de preparacion
            </label>
            <textarea id="cv-prep" rows={2} value={cvPrep} onChange={(e) => setCvPrep(e.target.value)} className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]" />
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
            <input type="checkbox" checked={cvMarkCompleted} onChange={(e) => setCvMarkCompleted(e.target.checked)} className="w-4 h-4 accent-[#0E7490]" />
            Marcar el tema como completado al agendar
          </label>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button type="button" onClick={() => setConvertTopic(null)} className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]">
              Cancelar
            </button>
            <button type="submit" disabled={savingCv} className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold">
              {savingCv ? "Agendando..." : "Agendar Evento"}
            </button>
          </div>
        </form>
      </ClinicalModal>
    </div>
  );
}
