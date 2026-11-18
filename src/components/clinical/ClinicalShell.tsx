"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CalendarClock,
  ClipboardList,
  Database,
  Pill,
  RefreshCw,
  Send,
} from "lucide-react";
import type {
  CommandCenterSnapshot,
  EventCategory,
  IntakeConstraint,
  IntakeStatus,
  MedFrequencyType,
  NoteType,
  TaskStatus,
} from "@/lib/types/clinical";
import { cn, formatDateTimeEs } from "@/lib/utils";
import { CommandCenterView } from "./CommandCenterView";
import { MedicationsInventoryView } from "./MedicationsInventoryView";
import { ClinicalEventsView } from "./ClinicalEventsView";
import { FollowUpTopicsView } from "./FollowUpTopicsView";
import { TelegramConfigView } from "./TelegramConfigView";
import { StatusBadge } from "./StatusBadge";

type TabId = "command" | "inventory" | "events" | "topics" | "telegram";

interface ClinicalShellProps {
  initialSnapshot: CommandCenterSnapshot;
}

export function ClinicalShell({ initialSnapshot }: ClinicalShellProps) {
  const [snapshot, setSnapshot] =
    useState<CommandCenterSnapshot>(initialSnapshot);
  const [activeTab, setActiveTab] = useState<TabId>("command");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshSnapshot = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/command-center", { cache: "no-store" });
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
  }, []);

  // Cron despachador cada 60 segundos mientras la consola clinica esta activa
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

  // Optimistic UI: Confirmar bloque completo
  async function handleConfirmCluster(clusterId: string, dateStr: string) {
    const previous = snapshot;
    const nowIso = new Date().toISOString();

    setSnapshot((prev) => {
      const updatedClusters = prev.today_clusters.map((block) => {
        if (block.cluster_id !== clusterId) return block;
        return {
          ...block,
          block_status: "TAKEN" as const,
          telegram_notification: block.telegram_notification
            ? {
                ...block.telegram_notification,
                status: "ACKNOWLEDGED" as const,
                acknowledged_at: nowIso,
              }
            : null,
          items: block.items.map((item) => ({
            ...item,
            status: "TAKEN" as const,
            taken_at: nowIso,
            recorded_by: "Consola Clinica Web",
            current_stock: Math.max(
              0,
              Number((item.current_stock - item.quantity_deducted).toFixed(2))
            ),
          })),
        };
      });
      return { ...prev, today_clusters: updatedClusters };
    });

    try {
      await postJson("/api/intakes/confirm", {
        action: "confirm_cluster",
        cluster_id: clusterId,
        date_str: dateStr,
        recorded_by: "Consola Clinica Web",
      });
      setSyncMessage("[CONFIRMADO] Bloque administrado y stock actualizado en PostgreSQL.");
      await refreshSnapshot();
    } catch (err) {
      setSnapshot(previous);
      setSyncError(err instanceof Error ? err.message : "Error al confirmar bloque.");
    }
  }

  // Optimistic UI: Actualizar toma individual
  async function handleUpdateIntakeLog(
    intakeLogId: string,
    status: IntakeStatus
  ) {
    const previous = snapshot;
    const nowIso = new Date().toISOString();

    setSnapshot((prev) => ({
      ...prev,
      today_clusters: prev.today_clusters.map((block) => ({
        ...block,
        items: block.items.map((item) =>
          item.intake_log_id === intakeLogId
            ? {
                ...item,
                status,
                taken_at: status === "TAKEN" ? nowIso : item.taken_at,
                recorded_by: "Consola Clinica Web",
              }
            : item
        ),
      })),
    }));

    try {
      await postJson("/api/intakes/confirm", {
        action: "confirm_single",
        intake_log_id: intakeLogId,
        status,
        recorded_by: "Consola Clinica Web",
      });
      setSyncMessage(`[ACTUALIZADO] Toma marcada como ${status}.`);
      await refreshSnapshot();
    } catch (err) {
      setSnapshot(previous);
      setSyncError(err instanceof Error ? err.message : "Error al registrar toma.");
    }
  }

  // Optimistic UI: Restock
  async function handleRestockMedication(
    medicationId: string,
    quantity: number
  ) {
    const previous = snapshot;

    setSnapshot((prev) => {
      const updatedMeds = prev.medications.map((m) => {
        if (m.id !== medicationId) return m;
        const nextStock = Number((m.current_stock + quantity).toFixed(2));
        const nextDays =
          m.daily_consumption_rate > 0
            ? Number((nextStock / m.daily_consumption_rate).toFixed(2))
            : 999;
        return {
          ...m,
          current_stock: nextStock,
          days_of_supply_remaining: nextDays,
        };
      });
      return {
        ...prev,
        medications: updatedMeds,
        low_stock_medications: updatedMeds.filter(
          (m) => m.days_of_supply_remaining <= 7
        ),
      };
    });

    try {
      await postJson("/api/intakes/confirm", {
        action: "restock",
        medication_id: medicationId,
        quantity,
      });
      setSyncMessage(`[RESTOCK COMPLETADO] +${quantity} unidades agregadas al inventario.`);
      await refreshSnapshot();
    } catch (err) {
      setSnapshot(previous);
      setSyncError(err instanceof Error ? err.message : "Error al registrar restock.");
    }
  }

  async function handleCreateMedication(payload: {
    name: string;
    active_ingredient: string;
    presentation: string;
    dose_amount: number;
    current_stock: number;
    frequency_type: MedFrequencyType;
    frequency_value: number;
    tolerance_window_mins: number;
    intake_rule: IntakeConstraint;
    clinical_notes: string;
    ideal_times: string[];
  }) {
    await postJson("/api/medications", { action: "create", ...payload });
    setSyncMessage(`[REGISTRADO] ${payload.name} optimizado en bloques horarios.`);
    await refreshSnapshot();
  }

  async function handleGenerateTodayLogs() {
    await postJson("/api/medications", { action: "generate_today" });
    setSyncMessage("[ACTUALIZADO] Tomas y recordatorios diarios regenerados.");
    await refreshSnapshot();
  }

  async function handleCreateEvent(payload: {
    title: string;
    category: EventCategory;
    specialist_or_center: string;
    location_address: string;
    event_datetime: string;
    is_recurring: boolean;
    recurrence_interval_days: number | null;
    medication_id: string | null;
    preparation_instructions: string;
  }) {
    await postJson("/api/events", { action: "create", ...payload });
    setSyncMessage(`[PROGRAMADO] ${payload.title} con cascada -7d/-3d/-1d/0d.`);
    await refreshSnapshot();
  }

  async function handleCompleteEvent(eventId: string) {
    const previous = snapshot;
    setSnapshot((prev) => ({
      ...prev,
      upcoming_events: prev.upcoming_events.filter((e) => e.id !== eventId),
    }));
    try {
      const res = await postJson<{
        nextEventId: string | null;
        stockDeducted: boolean;
      }>("/api/events", {
        action: "complete",
        event_id: eventId,
        recorded_by: "Consola Clinica Web",
      });
      setSyncMessage(
        res.nextEventId
          ? "[CICLO RENOVADO] Evento completado y siguiente ciclo programado automaticamente."
          : "[EVENTO COMPLETADO] Registro guardado en bitacora clinica."
      );
      await refreshSnapshot();
    } catch (err) {
      setSnapshot(previous);
      setSyncError(err instanceof Error ? err.message : "Error al completar evento.");
    }
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

  async function handleCreateTopic(payload: {
    title: string;
    description: string;
    priority: number;
    deadline_at: string;
  }) {
    await postJson("/api/topics", { action: "create_topic", ...payload });
    setSyncMessage(`[CASO CREADO] ${payload.title} con alertas de fecha limite.`);
    await refreshSnapshot();
  }

  async function handleUpdateTopic(
    topicId: string,
    updates: {
      status?: TaskStatus;
      priority?: number;
      progress_percentage?: number;
      deadline_at?: string;
    }
  ) {
    const previous = snapshot;
    setSnapshot((prev) => ({
      ...prev,
      open_topics: prev.open_topics.map((t) =>
        t.id === topicId ? { ...t, ...updates } : t
      ),
    }));
    try {
      await postJson("/api/topics", {
        action: "update_topic",
        topic_id: topicId,
        ...updates,
      });
      setSyncMessage("[ACTUALIZADO] Estado y progreso de caso guardados.");
      await refreshSnapshot();
    } catch (err) {
      setSnapshot(previous);
      setSyncError(err instanceof Error ? err.message : "Error al actualizar tema.");
    }
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
    setSyncMessage("[BITACORA] Anotacion estructurada agregada al tema.");
    await refreshSnapshot();
  }

  async function handleSaveRecipient(payload: {
    full_name: string;
    role: string;
    telegram_chat_id: string;
    receive_med_reminders: boolean;
    receive_restock_alerts: boolean;
    receive_event_reminders: boolean;
    receive_topic_reminders: boolean;
  }) {
    await postJson("/api/telegram/recipients", {
      action: "upsert",
      ...payload,
    });
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
    const previous = snapshot;
    setSnapshot((prev) => ({
      ...prev,
      telegram_recipients: prev.telegram_recipients.map((r) =>
        r.id === recipientId ? { ...r, [field]: value } : r
      ),
    }));
    try {
      await postJson("/api/telegram/recipients", {
        action: "toggle",
        recipient_id: recipientId,
        field,
        value,
      });
      await refreshSnapshot();
    } catch (err) {
      setSnapshot(previous);
      setSyncError(err instanceof Error ? err.message : "Error al actualizar permisos.");
    }
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

  const tabs: Array<{
    id: TabId;
    label: string;
    count?: number;
    icon: typeof Activity;
  }> = [
    {
      id: "command",
      label: "Command Center",
      icon: Activity,
    },
    {
      id: "inventory",
      label: "Inventario Farmacologico",
      count: snapshot.low_stock_medications.length || undefined,
      icon: Pill,
    },
    {
      id: "events",
      label: "Agenda Clinica",
      count: snapshot.upcoming_events.length || undefined,
      icon: CalendarClock,
    },
    {
      id: "topics",
      label: "Temas de Seguimiento",
      count: snapshot.open_topics.length || undefined,
      icon: ClipboardList,
    },
    {
      id: "telegram",
      label: "Telegram Bot",
      icon: Send,
    },
  ];

  return (
    <div className="min-h-dvh flex flex-col bg-[#F8FAFC]">
      {/* Barra superior clinica fija (72px desktop / 56px movil) */}
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
                Monitoreo Clinico y Cuidado Familiar
              </h1>
              <p className="hidden sm:block font-mono text-[13px] text-[#94A3B8] tabular-nums">
                Consola Operativa | Fecha: {snapshot.target_date}
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
              onClick={refreshSnapshot}
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

        {/* Navegacion primaria de las 5 vistas */}
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
                        tab.id === "inventory"
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

      {/* Contenido Principal */}
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
            onConfirmCluster={handleConfirmCluster}
            onUpdateIntakeLog={handleUpdateIntakeLog}
            onRestockMedication={handleRestockMedication}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === "inventory" && (
          <MedicationsInventoryView
            snapshot={snapshot}
            onCreateMedication={handleCreateMedication}
            onRestockMedication={handleRestockMedication}
            onGenerateTodayLogs={handleGenerateTodayLogs}
          />
        )}

        {activeTab === "events" && (
          <ClinicalEventsView
            snapshot={snapshot}
            onCreateEvent={handleCreateEvent}
            onCompleteEvent={handleCompleteEvent}
            onRescheduleEvent={handleRescheduleEvent}
          />
        )}

        {activeTab === "topics" && (
          <FollowUpTopicsView
            snapshot={snapshot}
            onCreateTopic={handleCreateTopic}
            onUpdateTopic={handleUpdateTopic}
            onAddAnnotation={handleAddAnnotation}
          />
        )}

        {activeTab === "telegram" && (
          <TelegramConfigView
            snapshot={snapshot}
            onSaveRecipient={handleSaveRecipient}
            onToggleRecipientPermission={handleToggleRecipientPermission}
            onDispatchQueue={handleDispatchQueue}
            onSimulateWebhook={handleSimulateWebhook}
            onTestConnection={handleTestConnection}
            onRegisterVercelWebhook={handleRegisterVercelWebhook}
          />
        )}
      </main>

      {/* Pie clinico informativo */}
      <footer className="border-t border-[#E2E8F0] bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 py-3.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#475569] font-mono tabular-nums">
          <span>
            Ultima sincronizacion: {formatDateTimeEs(snapshot.generated_at)}
          </span>
          <div className="flex items-center gap-2">
            <StatusBadge label="CERO EMOJIS VERIFICADO" tone="ok" />
            <StatusBadge label="POSTGRESQL TRIGGERS ACTIVOS" tone="info" />
          </div>
        </div>
      </footer>
    </div>
  );
}
