"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CalendarClock,
  ClipboardList,
  Database,
  FileHeart,
  Pill,
  RefreshCw,
  Send,
  Wallet,
} from "lucide-react";
import type {
  CommandCenterSnapshot,
  EventCategory,
  ExpenseCategory,
  ExpenseStatus,
  IntakeConstraint,
  IntakeStatus,
  NoteType,
  PayScheduleType,
  TaskStatus,
} from "@/lib/types/clinical";
import { cn, formatDateTimeEs } from "@/lib/utils";
import { CommandCenterView } from "./CommandCenterView";
import {
  MedicationsInventoryView,
  type SaveMedicationPayload,
} from "./MedicationsInventoryView";
import { FinancialPlannerView } from "./FinancialPlannerView";
import {
  ClinicalEventsView,
  type SaveClinicalEventPayload,
} from "./ClinicalEventsView";
import { FollowUpTopicsView } from "./FollowUpTopicsView";
import { PatientDossierView } from "./PatientDossierView";
import { TelegramConfigView } from "./TelegramConfigView";
import { StatusBadge } from "./StatusBadge";

type TabId =
  | "command"
  | "inventory"
  | "finances"
  | "events"
  | "topics"
  | "dossier"
  | "telegram";

interface ClinicalShellProps {
  initialSnapshot: CommandCenterSnapshot;
}

export function ClinicalShell({ initialSnapshot }: ClinicalShellProps) {
  const [snapshot, setSnapshot] =
    useState<CommandCenterSnapshot>(initialSnapshot);
  const [selectedDate, setSelectedDate] = useState<string>(
    initialSnapshot.target_date
  );
  const [activeTab, setActiveTab] = useState<TabId>("command");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshSnapshot = useCallback(
    async (overrideDate?: string) => {
      const targetDate = overrideDate ?? selectedDate;
      setRefreshing(true);
      try {
        const res = await fetch(
          `/api/command-center?date=${encodeURIComponent(targetDate)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("Fallo al recargar estado clinico.");
        const data = (await res.json()) as CommandCenterSnapshot;
        setSnapshot(data);
        setSyncError(null);
      } catch (err) {
        setSyncError(
          err instanceof Error ? err.message : "Error de sincronizacion."
        );
      } finally {
        setRefreshing(false);
      }
    },
    [selectedDate]
  );

  // Despachador de cola cada 60 segundos mientras la consola clinica esta activa
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await fetch("/api/telegram/dispatch", { method: "POST" });
        await refreshSnapshot();
      } catch {
        // Silencioso en segundo plano para no interrumpir captura clinica
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [refreshSnapshot]);

  async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data?.error === "string" ? data.error : "Error en operacion."
      );
    }
    return data as T;
  }

  async function handleSelectDate(dateStr: string) {
    setSelectedDate(dateStr);
    await refreshSnapshot(dateStr);
  }

  // Tomas de medicamentos
  async function handleConfirmCluster(clusterId: string, dateStr: string) {
    const previous = snapshot;
    const nowIso = new Date().toISOString();

    setSnapshot((prev) => ({
      ...prev,
      today_clusters: prev.today_clusters.map((block) =>
        block.cluster_id !== clusterId
          ? block
          : {
              ...block,
              block_status: "TAKEN",
              items: block.items.map((item) => ({
                ...item,
                status: "TAKEN",
                taken_at: nowIso,
                recorded_by: "Consola Clinica Web",
                current_stock:
                  item.current_stock === null
                    ? null
                    : Math.max(
                        0,
                        Number(
                          (item.current_stock - item.quantity_deducted).toFixed(2)
                        )
                      ),
              })),
            }
      ),
    }));

    try {
      await postJson("/api/intakes/confirm", {
        action: "confirm_cluster",
        cluster_id: clusterId,
        date_str: dateStr,
        recorded_by: "Consola Clinica Web",
      });
      setSyncMessage("[CONFIRMADO] Bloque administrado y stock actualizado.");
      await refreshSnapshot();
    } catch (err) {
      setSnapshot(previous);
      setSyncError(
        err instanceof Error ? err.message : "Error al confirmar bloque."
      );
    }
  }

  async function handleUpdateIntakeLog(
    intakeLogId: string,
    status: IntakeStatus,
    observations?: string
  ) {
    try {
      await postJson("/api/intakes/confirm", {
        action: "confirm_single",
        intake_log_id: intakeLogId,
        status,
        recorded_by: "Consola Clinica Web",
        ...(observations !== undefined ? { observations } : {}),
      });
      setSyncMessage(`[ACTUALIZADO] Toma marcada como ${status}.`);
      await refreshSnapshot();
    } catch (err) {
      setSyncError(
        err instanceof Error ? err.message : "Error al actualizar toma."
      );
    }
  }

  async function handleDeleteIntakeLog(intakeLogId: string) {
    await postJson("/api/intakes/confirm", {
      action: "delete_log",
      intake_log_id: intakeLogId,
    });
    setSyncMessage("[ELIMINADO] Registro de toma borrado (stock reembolsado si aplicaba).");
    await refreshSnapshot();
  }

  async function handleRestockMedication(
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
  ) {
    await postJson("/api/intakes/confirm", {
      action: "restock",
      medication_id: medicationId,
      quantity,
      ...options,
    });
    setSyncMessage(
      `[RESTOCK COMPLETADO] +${quantity} unidades agregadas al inventario.`
    );
    await refreshSnapshot();
  }

  // Gobernanza de Medicamentos y Clusters
  async function handleSaveMedication(payload: SaveMedicationPayload) {
    await postJson("/api/medications", {
      action: payload.id ? "update" : "create",
      ...payload,
    });
    setSyncMessage(
      payload.id
        ? `[EDITADO] ${payload.name} actualizado y bloques recalculados.`
        : `[REGISTRADO] ${payload.name} optimizado en bloques horarios.`
    );
    await refreshSnapshot();
  }

  async function handleAdjustStock(
    medicationId: string,
    exactStock: number | null,
    reason: string
  ) {
    await postJson("/api/medications", {
      action: "adjust_stock",
      medication_id: medicationId,
      exact_stock: exactStock,
      reason,
    });
    setSyncMessage("[AJUSTE APLICADO] Inventario fijado con auditoria.");
    await refreshSnapshot();
  }

  async function handleArchiveMedication(
    medicationId: string,
    reason: string | null
  ) {
    await postJson("/api/medications", {
      action: "archive",
      medication_id: medicationId,
      reason,
    });
    setSyncMessage("[ARCHIVADO] Medicamento suspendido del esquema activo.");
    await refreshSnapshot();
  }

  async function handleRestoreMedication(medicationId: string) {
    await postJson("/api/medications", {
      action: "restore",
      medication_id: medicationId,
    });
    setSyncMessage("[RESTAURADO] Medicamento reactivado en el catalogo.");
    await refreshSnapshot();
  }

  async function handleDeleteMedication(medicationId: string) {
    await postJson("/api/medications", {
      action: "delete",
      medication_id: medicationId,
    });
    setSyncMessage("[ELIMINADO] Medicamento eliminado permanentemente.");
    await refreshSnapshot();
  }

  async function handleGenerateTodayLogs() {
    await postJson("/api/medications", {
      action: "generate_today",
      date_str: selectedDate,
    });
    setSyncMessage("[ACTUALIZADO] Tomas y recordatorios diarios regenerados.");
    await refreshSnapshot();
  }

  async function handleCreateCluster(payload: {
    label: string;
    anchor_time: string;
    intake_rule: IntakeConstraint;
  }) {
    await postJson("/api/medications", { action: "create_cluster", ...payload });
    setSyncMessage(`[BLOQUE CREADO] ${payload.label} (${payload.anchor_time}).`);
    await refreshSnapshot();
  }

  async function handleUpdateCluster(
    clusterId: string,
    payload: {
      label: string;
      anchor_time: string;
      intake_rule: IntakeConstraint;
      is_active: boolean;
    }
  ) {
    await postJson("/api/medications", {
      action: "update_cluster",
      cluster_id: clusterId,
      ...payload,
    });
    setSyncMessage(`[BLOQUE ACTUALIZADO] ${payload.label}.`);
    await refreshSnapshot();
  }

  async function handleDeleteCluster(clusterId: string) {
    await postJson("/api/medications", {
      action: "delete_cluster",
      cluster_id: clusterId,
    });
    setSyncMessage("[BLOQUE ELIMINADO] Tomas reasignadas automaticamente.");
    await refreshSnapshot();
  }

  // Modulo Financiero y Quincenas
  async function handleUpdateFinancialSettings(payload: {
    currency: string;
    pay_schedule_type: PayScheduleType;
    payday_1: number;
    payday_2: number;
    biweekly_anchor_date: string | null;
    quincenal_budget_cap: number | null;
    monthly_budget_cap: number | null;
    safety_buffer_days: number;
    planning_horizon_quincenas: number;
    include_events_in_plan: boolean;
  }) {
    await postJson("/api/finances", { action: "update_settings", ...payload });
    setSyncMessage("[PLAN QUINCENAL ACTUALIZADO] Calendario recalculado.");
    await refreshSnapshot();
  }

  async function handleCreateExpense(payload: {
    title: string;
    category: ExpenseCategory;
    status: ExpenseStatus;
    amount: number;
    expense_date: string;
    quincena_label: string | null;
    medication_id: string | null;
    clinical_event_id: string | null;
    provider_or_pharmacy: string | null;
    payment_method: string | null;
    notes: string | null;
  }) {
    await postJson("/api/finances", { action: "create_expense", ...payload });
    setSyncMessage(`[GASTO REGISTRADO] ${payload.title}.`);
    await refreshSnapshot();
  }

  async function handleUpdateExpense(
    expenseId: string,
    payload: {
      title: string;
      category: ExpenseCategory;
      status: ExpenseStatus;
      amount: number;
      expense_date: string;
      quincena_label: string | null;
      medication_id: string | null;
      clinical_event_id: string | null;
      provider_or_pharmacy: string | null;
      payment_method: string | null;
      notes: string | null;
    }
  ) {
    await postJson("/api/finances", {
      action: "update_expense",
      expense_id: expenseId,
      ...payload,
    });
    setSyncMessage(`[GASTO ACTUALIZADO] ${payload.title}.`);
    await refreshSnapshot();
  }

  async function handleDeleteExpense(expenseId: string) {
    await postJson("/api/finances", {
      action: "delete_expense",
      expense_id: expenseId,
    });
    setSyncMessage("[GASTO ELIMINADO] Registro borrado de bitacora.");
    await refreshSnapshot();
  }

  async function handleExecutePlannedPurchase(payload: {
    medication_id: string;
    packages: number;
    package_price: number | null;
    total_amount: number;
    purchase_date: string;
    quincena_label: string;
    provider_or_pharmacy: string | null;
    payment_method: string | null;
    notes: string | null;
  }) {
    await postJson("/api/finances", {
      action: "execute_planned_purchase",
      ...payload,
    });
    setSyncMessage(
      "[COMPRA EJECUTADA] Stock incrementado, alertas cerradas y gasto registrado."
    );
    await refreshSnapshot();
  }

  // Agenda Clinica
  async function handleSaveEvent(payload: SaveClinicalEventPayload) {
    await postJson("/api/events", {
      action: payload.event_id ? "update" : "create",
      ...payload,
    });
    setSyncMessage(
      payload.event_id
        ? `[EVENTO ACTUALIZADO] ${payload.title}.`
        : `[PROGRAMADO] ${payload.title} con cascada -7d/-3d/-1d/0d.`
    );
    await refreshSnapshot();
  }

  async function handleCompleteEvent(
    eventId: string,
    options?: {
      actual_cost?: number | null;
      notes?: string | null;
      log_expense?: boolean;
    }
  ) {
    const res = await postJson<{
      nextEventId: string | null;
      expenseLogged: boolean;
    }>("/api/events", {
      action: "complete",
      event_id: eventId,
      recorded_by: "Consola Clinica Web",
      ...options,
    });
    setSyncMessage(
      res.nextEventId
        ? `[CICLO RENOVADO] Evento completado y siguiente ciclo programado.${
            res.expenseLogged ? " Gasto registrado." : ""
          }`
        : `[EVENTO COMPLETADO] Registro guardado.${
            res.expenseLogged ? " Gasto registrado." : ""
          }`
    );
    await refreshSnapshot();
  }

  async function handleRescheduleEvent(eventId: string, newDatetime: string) {
    await postJson("/api/events", {
      action: "reschedule",
      event_id: eventId,
      event_datetime: newDatetime,
    });
    setSyncMessage("[REPROGRAMADO] Nueva fecha guardada y alertas regeneradas.");
    await refreshSnapshot();
  }

  async function handleReopenEvent(eventId: string) {
    await postJson("/api/events", { action: "reopen", event_id: eventId });
    setSyncMessage("[REABIERTO] Evento regresado a Agenda Programada.");
    await refreshSnapshot();
  }

  async function handleDeleteEvent(eventId: string) {
    await postJson("/api/events", { action: "delete", event_id: eventId });
    setSyncMessage("[ELIMINADO] Evento clinico y alertas asociadas borradas.");
    await refreshSnapshot();
  }

  // Temas de Seguimiento
  async function handleCreateTopic(payload: {
    title: string;
    description: string;
    priority: number;
    deadline_at: string;
    estimated_budget: number | null;
  }) {
    await postJson("/api/topics", { action: "create_topic", ...payload });
    setSyncMessage(`[CASO CREADO] ${payload.title}.`);
    await refreshSnapshot();
  }

  async function handleUpdateTopic(
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
  ) {
    await postJson("/api/topics", {
      action: "update_topic",
      topic_id: topicId,
      ...updates,
    });
    setSyncMessage("[ACTUALIZADO] Tema de seguimiento guardado.");
    await refreshSnapshot();
  }

  async function handleDeleteTopic(topicId: string) {
    await postJson("/api/topics", { action: "delete_topic", topic_id: topicId });
    setSyncMessage("[ELIMINADO] Tema y bitacora eliminados.");
    await refreshSnapshot();
  }

  async function handleAddAnnotation(payload: {
    topic_id: string;
    author: string;
    note_type: NoteType;
    contact_name: string;
    contact_phone: string;
    estimated_cost: number | null;
    content: string;
  }) {
    await postJson("/api/topics", { action: "add_annotation", ...payload });
    setSyncMessage("[BITACORA] Anotacion agregada al tema.");
    await refreshSnapshot();
  }

  async function handleUpdateAnnotation(
    annotationId: string,
    payload: {
      author: string;
      note_type: NoteType;
      contact_name: string;
      contact_phone: string;
      estimated_cost: number | null;
      content: string;
    }
  ) {
    await postJson("/api/topics", {
      action: "update_annotation",
      annotation_id: annotationId,
      ...payload,
    });
    setSyncMessage("[BITACORA] Anotacion actualizada.");
    await refreshSnapshot();
  }

  async function handleDeleteAnnotation(annotationId: string) {
    await postJson("/api/topics", {
      action: "delete_annotation",
      annotation_id: annotationId,
    });
    setSyncMessage("[BITACORA] Anotacion eliminada.");
    await refreshSnapshot();
  }

  async function handleConvertTopicToEvent(payload: {
    topic_id: string;
    title: string;
    category: EventCategory;
    specialist_or_center: string | null;
    location_address: string | null;
    event_datetime: string;
    estimated_cost: number | null;
    preparation_instructions: string | null;
    mark_topic_completed: boolean;
  }) {
    await postJson("/api/topics", { action: "convert_to_event", ...payload });
    setSyncMessage(`[AGENDADO] "${payload.title}" agregado a Agenda Clinica.`);
    await refreshSnapshot();
  }

  // Expediente y Directorio Medico
  async function handleUpdateProfile(payload: {
    full_name: string;
    birth_date: string | null;
    blood_type: string | null;
    weight_kg: number | null;
    height_cm: number | null;
    allergies: string | null;
    chronic_conditions: string | null;
    insurance_provider: string | null;
    insurance_policy: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    emergency_contact_relation: string | null;
    general_notes: string | null;
  }) {
    await postJson("/api/dossier", { action: "update_profile", ...payload });
    setSyncMessage("[EXPEDIENTE] Ficha clinica del paciente actualizada.");
    await refreshSnapshot();
  }

  async function handleCreateProvider(payload: {
    name: string;
    specialty: string;
    clinic_or_center: string | null;
    city: string | null;
    phone: string | null;
    consultation_fee: number | null;
    address: string | null;
    notes: string | null;
    is_active: boolean;
  }) {
    await postJson("/api/dossier", { action: "create_provider", ...payload });
    setSyncMessage(`[DIRECTORIO] ${payload.name} agregado.`);
    await refreshSnapshot();
  }

  async function handleUpdateProvider(
    providerId: string,
    payload: {
      name: string;
      specialty: string;
      clinic_or_center: string | null;
      city: string | null;
      phone: string | null;
      consultation_fee: number | null;
      address: string | null;
      notes: string | null;
      is_active: boolean;
    }
  ) {
    await postJson("/api/dossier", {
      action: "update_provider",
      provider_id: providerId,
      ...payload,
    });
    setSyncMessage(`[DIRECTORIO] ${payload.name} actualizado.`);
    await refreshSnapshot();
  }

  async function handleDeleteProvider(providerId: string) {
    await postJson("/api/dossier", {
      action: "delete_provider",
      provider_id: providerId,
    });
    setSyncMessage("[DIRECTORIO] Especialista eliminado.");
    await refreshSnapshot();
  }

  // Telegram Gobernanza
  async function handleSaveRecipient(payload: {
    recipient_id?: string;
    full_name: string;
    role: string;
    telegram_chat_id: string;
    receive_med_reminders: boolean;
    receive_restock_alerts: boolean;
    receive_event_reminders: boolean;
    receive_topic_reminders: boolean;
  }) {
    if (payload.recipient_id) {
      await postJson("/api/telegram/recipients", {
        action: "update",
        recipient_id: payload.recipient_id,
        full_name: payload.full_name,
        role: payload.role,
        telegram_chat_id: payload.telegram_chat_id,
      });
    } else {
      await postJson("/api/telegram/recipients", {
        action: "upsert",
        ...payload,
      });
    }
    await refreshSnapshot();
  }

  async function handleDeleteRecipient(recipientId: string) {
    await postJson("/api/telegram/recipients", {
      action: "delete",
      recipient_id: recipientId,
    });
    setSyncMessage("[TELEGRAM] Destinatario eliminado.");
    await refreshSnapshot();
  }

  async function handleToggleRecipientPermission(
    recipientId: string,
    field:
      | "receive_med_reminders"
      | "receive_restock_alerts"
      | "receive_event_reminders"
      | "receive_topic_reminders"
      | "is_active",
    value: boolean
  ) {
    await postJson("/api/telegram/recipients", {
      action: "toggle",
      recipient_id: recipientId,
      field,
      value,
    });
    await refreshSnapshot();
  }

  async function handleRetryNotification(notifId: string) {
    await postJson("/api/telegram/recipients", {
      action: "retry_notification",
      notification_id: notifId,
    });
    setSyncMessage("[TELEGRAM] Notificacion reencolada.");
    await refreshSnapshot();
  }

  async function handleCancelNotification(notifId: string) {
    await postJson("/api/telegram/recipients", {
      action: "cancel_notification",
      notification_id: notifId,
    });
    setSyncMessage("[TELEGRAM] Notificacion cancelada/atendida.");
    await refreshSnapshot();
  }

  async function handleDeleteNotification(notifId: string) {
    await postJson("/api/telegram/recipients", {
      action: "delete_notification",
      notification_id: notifId,
    });
    setSyncMessage("[TELEGRAM] Notificacion eliminada de cola.");
    await refreshSnapshot();
  }

  async function handlePurgeAcknowledged() {
    const res = await postJson<{ purgedCount: number }>(
      "/api/telegram/recipients",
      { action: "purge_acknowledged" }
    );
    await refreshSnapshot();
    return res;
  }

  async function handleDispatchQueue() {
    const res = await postJson<{ dispatched: number; mode: string }>(
      "/api/telegram/dispatch",
      {}
    );
    await refreshSnapshot();
    return res;
  }

  async function handleSimulateWebhook(payload: {
    type: "callback" | "command";
    callback_data?: string;
    command?: string;
    chat_id?: string;
  }) {
    const update =
      payload.type === "command"
        ? {
            update_id: Date.now(),
            message: {
              message_id: Date.now(),
              chat: { id: Number(payload.chat_id ?? "100100002") },
              text: payload.command ?? "/estado",
            },
          }
        : {
            update_id: Date.now(),
            callback_query: {
              id: `sim_${Date.now()}`,
              from: { id: Number(payload.chat_id ?? "100100002") },
              message: {
                message_id: 9001,
                chat: { id: Number(payload.chat_id ?? "100100002") },
                text: "Notificacion clinica",
              },
              data: payload.callback_data ?? "",
            },
          };

    const res = await postJson<{ statusHtml?: string; message?: string }>(
      "/api/telegram/webhook?simulate=1",
      update
    );
    await refreshSnapshot();
    return res;
  }

  async function handleTestConnection() {
    return postJson<{
      configured: boolean;
      ok: boolean;
      botUsername?: string;
      detail: string;
    }>("/api/telegram/recipients", { action: "test_connection" });
  }

  async function handleRegisterVercelWebhook(baseUrl: string) {
    return postJson<{
      ok: boolean;
      simulated: boolean;
      webhook_url: string;
      secret_configured: boolean;
      detail: string;
    }>("/api/telegram/recipients", {
      action: "register_webhook",
      base_url: baseUrl,
    });
  }

  const invAlertCount =
    snapshot.low_stock_medications.length +
    snapshot.incomplete_medications.length;

  const tabs: Array<{
    id: TabId;
    label: string;
    count?: number;
    alertTone?: boolean;
    icon: typeof Activity;
  }> = [
    {
      id: "command",
      label: "Command Center",
      icon: Activity,
    },
    {
      id: "inventory",
      label: "Inventario",
      count: invAlertCount || undefined,
      alertTone: snapshot.low_stock_medications.length > 0,
      icon: Pill,
    },
    {
      id: "finances",
      label: "Finanzas y Quincenas",
      count: snapshot.financial_plan.buckets[0]?.purchases.length || undefined,
      icon: Wallet,
    },
    {
      id: "events",
      label: "Agenda Clinica",
      count: snapshot.upcoming_events.length || undefined,
      icon: CalendarClock,
    },
    {
      id: "topics",
      label: "Seguimiento",
      count: snapshot.open_topics.length || undefined,
      icon: ClipboardList,
    },
    {
      id: "dossier",
      label: "Expediente",
      icon: FileHeart,
    },
    {
      id: "telegram",
      label: "Telegram Bot",
      icon: Send,
    },
  ];

  return (
    <div className="min-h-dvh flex flex-col bg-[#F8FAFC]">
      <header className="sticky top-0 z-30 bg-[#0F172A] text-[#F8FAFC] border-b border-[#1E293B]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 h-[64px] sm:h-[72px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-8 h-8 rounded-[6px] bg-[#164E63] border border-[#0891B2] flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Activity className="w-4 h-4 text-[#22D3EE]" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[16px] sm:text-[18px] font-bold tracking-tight text-white truncate">
                Monitoreo Clinico y Gobernanza Familiar
              </h1>
              <p className="hidden sm:block font-mono text-[13px] text-[#94A3B8] tabular-nums">
                {snapshot.patient_profile.full_name} | Fecha: {snapshot.target_date}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border border-[#334155] bg-[#1E293B] font-mono text-[13px] text-[#E2E8F0]">
              <Database
                className="w-3.5 h-3.5 text-[#22D3EE]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {snapshot.db_mode === "NEON_POOL"
                ? "NEON POOL"
                : "POSTGRES LOCAL"}
            </span>

            <button
              type="button"
              onClick={() => refreshSnapshot()}
              disabled={refreshing}
              className="clinical-btn inline-flex items-center gap-1.5 px-3 bg-[#1E293B] hover:bg-[#334155] border border-[#334155] text-[#F8FAFC] text-[13px] font-medium"
              aria-label="Sincronizar datos clinicos"
            >
              <RefreshCw
                className={cn("w-4 h-4", refreshing && "animate-spin")}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Sincronizar</span>
            </button>
          </div>
        </div>

        <nav
          aria-label="Vistas del sistema clinico"
          className="bg-[#FFFFFF] text-[#0F172A] border-b border-[#E2E8F0]"
        >
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 flex items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "min-h-[48px] px-3.5 py-2 inline-flex items-center gap-2 border-b-2 text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors duration-150",
                    isActive
                      ? "border-[#0E7490] text-[#0E7490] font-bold bg-[#F8FAFC]"
                      : "border-transparent text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]"
                  )}
                >
                  <Icon
                    className="w-4 h-4 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={cn(
                        "font-mono text-[13px] px-1.5 py-0.5 rounded-[4px] tabular-nums",
                        tab.alertTone
                          ? "bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]"
                          : "bg-[#F1F5F9] text-[#334155]"
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      <main
        id="main-content"
        className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 lg:px-10 py-6 space-y-5"
      >
        {(syncMessage || syncError) && (
          <div
            role="status"
            className={cn(
              "px-4 py-3 rounded-[6px] border flex flex-wrap items-center justify-between gap-2 text-[14px]",
              syncError
                ? "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]"
                : "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]"
            )}
          >
            <span className="font-mono font-medium">
              {syncError ?? syncMessage}
            </span>
            <button
              type="button"
              onClick={() => {
                setSyncMessage(null);
                setSyncError(null);
              }}
              className="text-[13px] underline font-medium"
            >
              Cerrar aviso
            </button>
          </div>
        )}

        {activeTab === "command" && (
          <CommandCenterView
            snapshot={snapshot}
            onSelectDate={handleSelectDate}
            onConfirmCluster={handleConfirmCluster}
            onUpdateIntakeLog={handleUpdateIntakeLog}
            onDeleteIntakeLog={handleDeleteIntakeLog}
            onRestockMedication={handleRestockMedication}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === "inventory" && (
          <MedicationsInventoryView
            snapshot={snapshot}
            onSaveMedication={handleSaveMedication}
            onRestockMedication={handleRestockMedication}
            onAdjustStock={handleAdjustStock}
            onArchiveMedication={handleArchiveMedication}
            onRestoreMedication={handleRestoreMedication}
            onDeleteMedication={handleDeleteMedication}
            onGenerateTodayLogs={handleGenerateTodayLogs}
            onCreateCluster={handleCreateCluster}
            onUpdateCluster={handleUpdateCluster}
            onDeleteCluster={handleDeleteCluster}
          />
        )}

        {activeTab === "finances" && (
          <FinancialPlannerView
            snapshot={snapshot}
            onUpdateSettings={handleUpdateFinancialSettings}
            onCreateExpense={handleCreateExpense}
            onUpdateExpense={handleUpdateExpense}
            onDeleteExpense={handleDeleteExpense}
            onExecutePlannedPurchase={handleExecutePlannedPurchase}
            onNavigateToInventory={() => setActiveTab("inventory")}
          />
        )}

        {activeTab === "events" && (
          <ClinicalEventsView
            snapshot={snapshot}
            onSaveEvent={handleSaveEvent}
            onCompleteEvent={handleCompleteEvent}
            onRescheduleEvent={handleRescheduleEvent}
            onReopenEvent={handleReopenEvent}
            onDeleteEvent={handleDeleteEvent}
          />
        )}

        {activeTab === "topics" && (
          <FollowUpTopicsView
            snapshot={snapshot}
            onCreateTopic={handleCreateTopic}
            onUpdateTopic={handleUpdateTopic}
            onDeleteTopic={handleDeleteTopic}
            onAddAnnotation={handleAddAnnotation}
            onUpdateAnnotation={handleUpdateAnnotation}
            onDeleteAnnotation={handleDeleteAnnotation}
            onConvertToEvent={handleConvertTopicToEvent}
          />
        )}

        {activeTab === "dossier" && (
          <PatientDossierView
            snapshot={snapshot}
            onUpdateProfile={handleUpdateProfile}
            onCreateProvider={handleCreateProvider}
            onUpdateProvider={handleUpdateProvider}
            onDeleteProvider={handleDeleteProvider}
          />
        )}

        {activeTab === "telegram" && (
          <TelegramConfigView
            snapshot={snapshot}
            onSaveRecipient={handleSaveRecipient}
            onDeleteRecipient={handleDeleteRecipient}
            onToggleRecipientPermission={handleToggleRecipientPermission}
            onRetryNotification={handleRetryNotification}
            onCancelNotification={handleCancelNotification}
            onDeleteNotification={handleDeleteNotification}
            onPurgeAcknowledged={handlePurgeAcknowledged}
            onDispatchQueue={handleDispatchQueue}
            onSimulateWebhook={handleSimulateWebhook}
            onTestConnection={handleTestConnection}
            onRegisterVercelWebhook={handleRegisterVercelWebhook}
          />
        )}
      </main>

      <footer className="border-t border-[#E2E8F0] bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 py-3.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#475569] font-mono tabular-nums">
          <span>
            Ultima sincronizacion: {formatDateTimeEs(snapshot.generated_at)}
          </span>
          <div className="flex items-center gap-2">
            <StatusBadge label="GOBERNANZA CRUD COMPLETA" tone="ok" />
            <StatusBadge label="PLANIFICADOR QUINCENAL" tone="info" />
          </div>
        </div>
      </footer>
    </div>
  );
}
