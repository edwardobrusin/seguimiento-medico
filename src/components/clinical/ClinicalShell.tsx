"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  FileHeart,
  LogOut,
  Pill,
  RefreshCw,
  Send,
  Wallet,
  X,
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
  UserRole,
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

export type TabId =
  | "command"
  | "inventory"
  | "finances"
  | "events"
  | "topics"
  | "dossier"
  | "telegram";

interface ClinicalShellProps {
  initialSnapshot: CommandCenterSnapshot;
  sessionUser: {
    username: string;
    displayName: string;
    role: UserRole;
  };
}

export function ClinicalShell({
  initialSnapshot,
  sessionUser,
}: ClinicalShellProps) {
  const router = useRouter();
  const isAdmin = sessionUser.role === "ADMIN";

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
        if (res.status === 401) {
          router.refresh();
          return;
        }
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
    [selectedDate, router]
  );

  // Auto-ocultar avisos de exito tras 4.5s (mantiene errores hasta cerrar)
  useEffect(() => {
    if (!syncMessage) return;
    const t = setTimeout(() => setSyncMessage(null), 4500);
    return () => clearTimeout(t);
  }, [syncMessage]);

  // Polling cada 60s (Paciente nunca llama a endpoints /api/telegram/*)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        if (isAdmin) {
          await fetch("/api/telegram/dispatch", { method: "POST" });
        }
        await refreshSnapshot();
      } catch {
        // Silencioso en segundo plano
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [isAdmin, refreshSnapshot]);

  async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      router.refresh();
      throw new Error("Tu sesion expiro. Vuelve a iniciar sesion.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : "No se pudo completar la operacion."
      );
    }
    return data as T;
  }

  async function runMutation<T>(
    fn: () => Promise<T>,
    successMsg?: string
  ): Promise<T> {
    setSyncError(null);
    try {
      const out = await fn();
      if (successMsg) setSyncMessage(successMsg);
      return out;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error al ejecutar operacion.";
      setSyncError(msg);
      setSyncMessage(null);
      throw err;
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
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
                recorded_by: sessionUser.displayName,
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
      });
      setSyncMessage("Bloque confirmado e inventario actualizado.");
      setSyncError(null);
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
    return runMutation(async () => {
      await postJson("/api/intakes/confirm", {
        action: "confirm_single",
        intake_log_id: intakeLogId,
        status,
        ...(observations !== undefined ? { observations } : {}),
      });
      await refreshSnapshot();
    }, "Toma actualizada correctamente.");
  }

  async function handleDeleteIntakeLog(intakeLogId: string) {
    return runMutation(async () => {
      await postJson("/api/intakes/confirm", {
        action: "delete_log",
        intake_log_id: intakeLogId,
      });
      await refreshSnapshot();
    }, "Registro de toma eliminado.");
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
    return runMutation(async () => {
      await postJson("/api/intakes/confirm", {
        action: "restock",
        medication_id: medicationId,
        quantity,
        ...options,
      });
      await refreshSnapshot();
    }, `Restock completado (+${quantity} unidades agregadas).`);
  }

  // Gobernanza de Medicamentos y Clusters
  async function handleSaveMedication(payload: SaveMedicationPayload) {
    return runMutation(
      async () => {
        await postJson("/api/medications", {
          action: payload.id ? "update" : "create",
          ...payload,
        });
        await refreshSnapshot();
      },
      payload.id
        ? `${payload.name} actualizado y horarios sincronizados.`
        : `${payload.name} registrado y optimizado en bloques.`
    );
  }

  async function handleAdjustStock(
    medicationId: string,
    exactStock: number | null,
    reason: string
  ) {
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "adjust_stock",
        medication_id: medicationId,
        exact_stock: exactStock,
        reason,
      });
      await refreshSnapshot();
    }, "Inventario ajustado correctamente.");
  }

  async function handleArchiveMedication(
    medicationId: string,
    reason: string | null
  ) {
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "archive",
        medication_id: medicationId,
        reason,
      });
      await refreshSnapshot();
    }, "Medicamento archivado del esquema activo.");
  }

  async function handleRestoreMedication(medicationId: string) {
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "restore",
        medication_id: medicationId,
      });
      await refreshSnapshot();
    }, "Medicamento reactivado en el catalogo.");
  }

  async function handleDeleteMedication(medicationId: string) {
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "delete",
        medication_id: medicationId,
      });
      await refreshSnapshot();
    }, "Medicamento eliminado permanentemente.");
  }

  async function handleRestoreMedicationVersion(
    medicationId: string,
    versionId: string
  ) {
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "restore_version",
        medication_id: medicationId,
        version_id: versionId,
      });
      await refreshSnapshot();
    }, "Version restaurada con exito y tomas recalculadas.");
  }

  async function handleMarkVersionReviewed(versionId: string) {
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "mark_version_reviewed",
        version_id: versionId,
      });
      await refreshSnapshot();
    }, "Cambio marcado como revisado.");
  }

  async function handleGenerateTodayLogs(overrideDate?: string) {
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "generate_today",
        date_str: overrideDate ?? selectedDate,
      });
      await refreshSnapshot();
    }, "Tomas diarias generadas respetando periodicidad.");
  }

  async function handleCreateCluster(payload: {
    label: string;
    anchor_time: string;
    intake_rule: IntakeConstraint;
  }) {
    return runMutation(async () => {
      await postJson("/api/medications", { action: "create_cluster", ...payload });
      await refreshSnapshot();
    }, `Bloque horario "${payload.label}" creado.`);
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
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "update_cluster",
        cluster_id: clusterId,
        ...payload,
      });
      await refreshSnapshot();
    }, `Bloque horario "${payload.label}" actualizado.`);
  }

  async function handleDeleteCluster(clusterId: string) {
    return runMutation(async () => {
      await postJson("/api/medications", {
        action: "delete_cluster",
        cluster_id: clusterId,
      });
      await refreshSnapshot();
    }, "Bloque eliminado y horarios reasignados.");
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
    return runMutation(async () => {
      await postJson("/api/finances", { action: "update_settings", ...payload });
      await refreshSnapshot();
    }, "Plan quincenal recalculado.");
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
    return runMutation(async () => {
      await postJson("/api/finances", { action: "create_expense", ...payload });
      await refreshSnapshot();
    }, `Gasto registrado: ${payload.title}.`);
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
    return runMutation(async () => {
      await postJson("/api/finances", {
        action: "update_expense",
        expense_id: expenseId,
        ...payload,
      });
      await refreshSnapshot();
    }, `Gasto actualizado: ${payload.title}.`);
  }

  async function handleDeleteExpense(expenseId: string) {
    return runMutation(async () => {
      await postJson("/api/finances", {
        action: "delete_expense",
        expense_id: expenseId,
      });
      await refreshSnapshot();
    }, "Gasto eliminado de la bitacora.");
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
    return runMutation(async () => {
      await postJson("/api/finances", {
        action: "execute_planned_purchase",
        ...payload,
      });
      await refreshSnapshot();
    }, "Compra aplicada a inventario y bitacora de gastos.");
  }

  // Agenda Clinica
  async function handleSaveEvent(payload: SaveClinicalEventPayload) {
    return runMutation(
      async () => {
        await postJson("/api/events", {
          action: payload.event_id ? "update" : "create",
          ...payload,
        });
        await refreshSnapshot();
      },
      payload.event_id
        ? `Evento "${payload.title}" actualizado.`
        : `Evento "${payload.title}" programado.`
    );
  }

  async function handleCompleteEvent(
    eventId: string,
    options?: {
      actual_cost?: number | null;
      notes?: string | null;
      log_expense?: boolean;
    }
  ) {
    return runMutation(async () => {
      const res = await postJson<{
        nextEventId: string | null;
        expenseLogged: boolean;
      }>("/api/events", {
        action: "complete",
        event_id: eventId,
        ...options,
      });
      await refreshSnapshot();
      setSyncMessage(
        res.nextEventId
          ? `Evento completado y siguiente ciclo generado.${
              res.expenseLogged ? " Gasto registrado." : ""
            }`
          : `Evento completado.${res.expenseLogged ? " Gasto registrado." : ""}`
      );
    });
  }

  async function handleRescheduleEvent(eventId: string, newDatetime: string) {
    return runMutation(async () => {
      await postJson("/api/events", {
        action: "reschedule",
        event_id: eventId,
        event_datetime: newDatetime,
      });
      await refreshSnapshot();
    }, "Fecha del evento actualizada.");
  }

  async function handleReopenEvent(eventId: string) {
    return runMutation(async () => {
      await postJson("/api/events", { action: "reopen", event_id: eventId });
      await refreshSnapshot();
    }, "Evento reabierto en la agenda.");
  }

  async function handleDeleteEvent(eventId: string) {
    return runMutation(async () => {
      await postJson("/api/events", { action: "delete", event_id: eventId });
      await refreshSnapshot();
    }, "Evento clinico eliminado.");
  }

  // Temas de Seguimiento
  async function handleCreateTopic(payload: {
    title: string;
    description: string;
    priority: number;
    deadline_at: string;
    estimated_budget: number | null;
  }) {
    return runMutation(async () => {
      await postJson("/api/topics", { action: "create_topic", ...payload });
      await refreshSnapshot();
    }, `Tema "${payload.title}" creado.`);
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
    return runMutation(async () => {
      await postJson("/api/topics", {
        action: "update_topic",
        topic_id: topicId,
        ...updates,
      });
      await refreshSnapshot();
    }, "Tema de seguimiento actualizado.");
  }

  async function handleDeleteTopic(topicId: string) {
    return runMutation(async () => {
      await postJson("/api/topics", { action: "delete_topic", topic_id: topicId });
      await refreshSnapshot();
    }, "Tema y bitacora eliminados.");
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
    return runMutation(async () => {
      await postJson("/api/topics", { action: "add_annotation", ...payload });
      await refreshSnapshot();
    }, "Anotacion registrada.");
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
    return runMutation(async () => {
      await postJson("/api/topics", {
        action: "update_annotation",
        annotation_id: annotationId,
        ...payload,
      });
      await refreshSnapshot();
    }, "Anotacion actualizada.");
  }

  async function handleDeleteAnnotation(annotationId: string) {
    return runMutation(async () => {
      await postJson("/api/topics", {
        action: "delete_annotation",
        annotation_id: annotationId,
      });
      await refreshSnapshot();
    }, "Anotacion eliminada.");
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
    return runMutation(async () => {
      await postJson("/api/topics", { action: "convert_to_event", ...payload });
      await refreshSnapshot();
    }, `"${payload.title}" agendado en Agenda Clinica.`);
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
    return runMutation(async () => {
      await postJson("/api/dossier", { action: "update_profile", ...payload });
      await refreshSnapshot();
    }, "Ficha clinica del paciente actualizada.");
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
    return runMutation(async () => {
      await postJson("/api/dossier", { action: "create_provider", ...payload });
      await refreshSnapshot();
    }, `Especialista "${payload.name}" agregado.`);
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
    return runMutation(async () => {
      await postJson("/api/dossier", {
        action: "update_provider",
        provider_id: providerId,
        ...payload,
      });
      await refreshSnapshot();
    }, `Especialista "${payload.name}" actualizado.`);
  }

  async function handleDeleteProvider(providerId: string) {
    return runMutation(async () => {
      await postJson("/api/dossier", {
        action: "delete_provider",
        provider_id: providerId,
      });
      await refreshSnapshot();
    }, "Especialista eliminado del directorio.");
  }

  // Solo Administrador: Cuentas de Acceso
  async function handleUpdateAuthUser(
    userId: string,
    payload: {
      username?: string;
      display_name?: string;
      new_password?: string;
    }
  ) {
    return runMutation(async () => {
      await postJson("/api/auth/users", {
        action: "update_user",
        user_id: userId,
        ...payload,
      });
      await refreshSnapshot();
    }, "Credenciales de acceso actualizadas.");
  }

  // Solo Administrador: Telegram y Monitoreo
  async function handleSaveRecipient(payload: {
    recipient_id?: string;
    full_name: string;
    role: string;
    telegram_chat_id: string;
    receive_med_reminders?: boolean;
    receive_restock_alerts?: boolean;
    receive_event_reminders?: boolean;
    receive_topic_reminders?: boolean;
    receive_missed_block_alerts?: boolean;
    receive_weekly_report?: boolean;
    receive_change_alerts?: boolean;
  }) {
    return runMutation(async () => {
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
    }, "Destinatario de Telegram guardado.");
  }

  async function handleDeleteRecipient(recipientId: string) {
    return runMutation(async () => {
      await postJson("/api/telegram/recipients", {
        action: "delete",
        recipient_id: recipientId,
      });
      await refreshSnapshot();
    }, "Destinatario eliminado de Telegram.");
  }

  async function handleToggleRecipientPermission(
    recipientId: string,
    field:
      | "receive_med_reminders"
      | "receive_restock_alerts"
      | "receive_event_reminders"
      | "receive_topic_reminders"
      | "receive_missed_block_alerts"
      | "receive_weekly_report"
      | "receive_change_alerts"
      | "is_active",
    value: boolean
  ) {
    return runMutation(async () => {
      await postJson("/api/telegram/recipients", {
        action: "toggle",
        recipient_id: recipientId,
        field,
        value,
      });
      await refreshSnapshot();
    });
  }

  async function handleRetryNotification(notifId: string) {
    return runMutation(async () => {
      await postJson("/api/telegram/recipients", {
        action: "retry_notification",
        notification_id: notifId,
      });
      await refreshSnapshot();
    }, "Notificacion reencolada para envio.");
  }

  async function handleCancelNotification(notifId: string) {
    return runMutation(async () => {
      await postJson("/api/telegram/recipients", {
        action: "cancel_notification",
        notification_id: notifId,
      });
      await refreshSnapshot();
    }, "Notificacion marcada como atendida.");
  }

  async function handleDeleteNotification(notifId: string) {
    return runMutation(async () => {
      await postJson("/api/telegram/recipients", {
        action: "delete_notification",
        notification_id: notifId,
      });
      await refreshSnapshot();
    }, "Notificacion eliminada de la cola.");
  }

  async function handlePurgeAcknowledged() {
    return runMutation(async () => {
      const res = await postJson<{ purgedCount: number }>(
        "/api/telegram/recipients",
        { action: "purge_acknowledged" }
      );
      await refreshSnapshot();
      return res;
    });
  }

  async function handleDispatchQueue() {
    return runMutation(async () => {
      const res = await postJson<{ dispatched: number; mode: string }>(
        "/api/telegram/dispatch",
        {}
      );
      await refreshSnapshot();
      return res;
    });
  }

  async function handleUpdateMonitoringSettings(payload: {
    timezone: string;
    missed_block_grace_mins: number;
    missed_block_alerts_enabled: boolean;
    weekly_report_enabled: boolean;
    weekly_report_day: number;
    weekly_report_hour: number;
    notify_admin_on_patient_change: boolean;
  }) {
    return runMutation(async () => {
      await postJson("/api/telegram/recipients", {
        action: "update_monitoring_settings",
        ...payload,
      });
      await refreshSnapshot();
    }, "Reglas de monitoreo administrativo actualizadas.");
  }

  async function handleSendWeeklyReportNow() {
    return runMutation(async () => {
      const res = await postJson<{ dispatched: number; reportHtml: string }>(
        "/api/telegram/recipients",
        { action: "send_weekly_report_now" }
      );
      await refreshSnapshot();
      return res;
    }, "Reporte semanal generado y despachado a administradores.");
  }

  async function handleCheckMissedBlocksNow() {
    return runMutation(async () => {
      const res = await postJson<{
        queued: number;
        dispatched: number;
        mode: string;
      }>("/api/telegram/recipients", { action: "check_missed_blocks_now" });
      await refreshSnapshot();
      return res;
    });
  }

  async function handleSimulateWebhook(payload: {
    type: "callback" | "command";
    callback_data?: string;
    command?: string;
    chat_id?: string;
  }) {
    return runMutation(async () => {
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
    });
  }

  async function handleTestConnection() {
    return runMutation(() =>
      postJson<{
        configured: boolean;
        ok: boolean;
        botUsername?: string;
        detail: string;
      }>("/api/telegram/recipients", { action: "test_connection" })
    );
  }

  async function handleRegisterVercelWebhook(baseUrl: string) {
    return runMutation(() =>
      postJson<{
        ok: boolean;
        simulated: boolean;
        webhook_url: string;
        secret_configured: boolean;
        detail: string;
      }>("/api/telegram/recipients", {
        action: "register_webhook",
        base_url: baseUrl,
      })
    );
  }

  const invAlertCount =
    snapshot.low_stock_medications.length +
    snapshot.incomplete_medications.length;

  const baseTabs: Array<{
    id: TabId;
    label: string;
    count?: number;
    alertTone?: boolean;
    icon: typeof Activity;
  }> = [
    {
      id: "command",
      label: "Resumen del Dia",
      icon: Activity,
    },
    {
      id: "inventory",
      label: "Medicamentos",
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
  ];

  const tabs = isAdmin
    ? [
        ...baseTabs,
        {
          id: "telegram" as TabId,
          label: "Telegram Bot",
          icon: Send,
        },
      ]
    : baseTabs;

  const effectiveTab: TabId =
    !isAdmin && activeTab === "telegram" ? "command" : activeTab;

  return (
    <div className="min-h-dvh flex flex-col bg-[#F8FAFC]">
      <header className="sticky top-0 z-30 bg-[#0F172A] text-[#F8FAFC] border-b border-[#1E293B]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 h-[64px] sm:h-[72px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-[6px] bg-[#164E63] border border-[#0891B2] flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Activity className="w-5 h-5 text-[#22D3EE]" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[16px] sm:text-[18px] font-bold tracking-tight text-white truncate">
                Seguimiento Clinico Familiar
              </h1>
              <p className="hidden sm:block font-mono text-[13px] text-[#94A3B8] tabular-nums">
                {snapshot.patient_profile.full_name} | {snapshot.target_date}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border border-[#334155] bg-[#1E293B] font-mono text-[12px] text-[#E2E8F0]">
                <Database
                  className="w-3.5 h-3.5 text-[#22D3EE]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                {snapshot.db_mode === "NEON_POOL" ? "NEON" : "LOCAL"}
              </span>
            )}

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

            <button
              type="button"
              onClick={handleLogout}
              className="clinical-btn inline-flex items-center gap-1.5 px-3 bg-[#1E293B] hover:bg-[#334155] border border-[#334155] text-[#CBD5E1] hover:text-white text-[13px] font-medium"
              aria-label="Cerrar sesion"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
              <span className="hidden sm:inline">Salir</span>
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
              const isActive = effectiveTab === tab.id;
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
        {effectiveTab === "command" && (
          <CommandCenterView
            snapshot={snapshot}
            isAdmin={isAdmin}
            onSelectDate={handleSelectDate}
            onConfirmCluster={handleConfirmCluster}
            onUpdateIntakeLog={handleUpdateIntakeLog}
            onDeleteIntakeLog={handleDeleteIntakeLog}
            onRestockMedication={handleRestockMedication}
            onGenerateTodayLogs={handleGenerateTodayLogs}
            onNavigateTab={setActiveTab}
          />
        )}

        {effectiveTab === "inventory" && (
          <MedicationsInventoryView
            snapshot={snapshot}
            isAdmin={isAdmin}
            onSaveMedication={handleSaveMedication}
            onRestockMedication={handleRestockMedication}
            onAdjustStock={handleAdjustStock}
            onArchiveMedication={handleArchiveMedication}
            onRestoreMedication={handleRestoreMedication}
            onDeleteMedication={handleDeleteMedication}
            onRestoreVersion={handleRestoreMedicationVersion}
            onMarkVersionReviewed={handleMarkVersionReviewed}
            onGenerateTodayLogs={handleGenerateTodayLogs}
            onCreateCluster={handleCreateCluster}
            onUpdateCluster={handleUpdateCluster}
            onDeleteCluster={handleDeleteCluster}
          />
        )}

        {effectiveTab === "finances" && (
          <FinancialPlannerView
            snapshot={snapshot}
            isAdmin={isAdmin}
            onUpdateSettings={handleUpdateFinancialSettings}
            onCreateExpense={handleCreateExpense}
            onUpdateExpense={handleUpdateExpense}
            onDeleteExpense={handleDeleteExpense}
            onExecutePlannedPurchase={handleExecutePlannedPurchase}
            onNavigateToInventory={() => setActiveTab("inventory")}
          />
        )}

        {effectiveTab === "events" && (
          <ClinicalEventsView
            snapshot={snapshot}
            isAdmin={isAdmin}
            onSaveEvent={handleSaveEvent}
            onCompleteEvent={handleCompleteEvent}
            onRescheduleEvent={handleRescheduleEvent}
            onReopenEvent={handleReopenEvent}
            onDeleteEvent={handleDeleteEvent}
          />
        )}

        {effectiveTab === "topics" && (
          <FollowUpTopicsView
            snapshot={snapshot}
            isAdmin={isAdmin}
            onCreateTopic={handleCreateTopic}
            onUpdateTopic={handleUpdateTopic}
            onDeleteTopic={handleDeleteTopic}
            onAddAnnotation={handleAddAnnotation}
            onUpdateAnnotation={handleUpdateAnnotation}
            onDeleteAnnotation={handleDeleteAnnotation}
            onConvertToEvent={handleConvertTopicToEvent}
          />
        )}

        {effectiveTab === "dossier" && (
          <PatientDossierView
            snapshot={snapshot}
            isAdmin={isAdmin}
            onUpdateProfile={handleUpdateProfile}
            onCreateProvider={handleCreateProvider}
            onUpdateProvider={handleUpdateProvider}
            onDeleteProvider={handleDeleteProvider}
            onUpdateAuthUser={handleUpdateAuthUser}
            onRestoreVersion={handleRestoreMedicationVersion}
            onMarkVersionReviewed={handleMarkVersionReviewed}
          />
        )}

        {isAdmin && effectiveTab === "telegram" && (
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
            onUpdateMonitoringSettings={handleUpdateMonitoringSettings}
            onSendWeeklyReportNow={handleSendWeeklyReportNow}
            onCheckMissedBlocksNow={handleCheckMissedBlocksNow}
          />
        )}
      </main>

      {/* Toast flotante accesible (siempre visible en pantalla al confirmar o fallar) */}
      {(syncMessage || syncError) && (
        <div
          role={syncError ? "alert" : "status"}
          aria-live={syncError ? "assertive" : "polite"}
          className={cn(
            "clinical-toast fixed bottom-4 right-4 z-50 max-w-md w-[calc(100vw-2rem)] sm:w-auto px-4 py-3 rounded-[6px] border shadow-lg flex items-center justify-between gap-3 text-[14px]",
            syncError
              ? "bg-[#FEF2F2] border-[#F87171] text-[#991B1B]"
              : "bg-[#ECFDF5] border-[#6EE7B7] text-[#065F46]"
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {syncError ? (
              <AlertCircle
                className="w-5 h-5 shrink-0"
                strokeWidth={1.85}
                aria-hidden="true"
              />
            ) : (
              <CheckCircle2
                className="w-5 h-5 shrink-0"
                strokeWidth={1.85}
                aria-hidden="true"
              />
            )}
            <span className="font-medium break-words">
              {syncError ?? syncMessage}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSyncMessage(null);
              setSyncError(null);
            }}
            aria-label="Cerrar aviso"
            className="w-9 h-9 inline-flex items-center justify-center rounded-[4px] hover:bg-black/5 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" strokeWidth={1.85} aria-hidden="true" />
          </button>
        </div>
      )}

      <footer className="border-t border-[#E2E8F0] bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 py-3.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#475569] font-mono tabular-nums">
          <span>
            Ultima actualizacion: {formatDateTimeEs(snapshot.generated_at)}
          </span>
          <span className="text-[#64748B]">
            {sessionUser.displayName}
          </span>
        </div>
      </footer>
    </div>
  );
}
