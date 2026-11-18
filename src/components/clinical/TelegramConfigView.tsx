"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Link2,
  Play,
  Send,
  ShieldCheck,
  Terminal,
  UserPlus,
} from "lucide-react";
import type {
  CommandCenterSnapshot,
  NotificationQueueItem,
  TelegramRecipient,
} from "@/lib/types/clinical";
import { ALERT_STATUS_TAG, RECIPIENT_ROLE_TAG } from "@/lib/clinical-labels";
import { cn, formatDateTimeEs } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

interface TelegramConfigViewProps {
  snapshot: CommandCenterSnapshot;
  onSaveRecipient: (payload: {
    full_name: string;
    role: string;
    telegram_chat_id: string;
    receive_med_reminders: boolean;
    receive_restock_alerts: boolean;
    receive_event_reminders: boolean;
    receive_topic_reminders: boolean;
  }) => Promise<void>;
  onToggleRecipientPermission: (
    recipientId: string,
    field:
      | "receive_med_reminders"
      | "receive_restock_alerts"
      | "receive_event_reminders"
      | "receive_topic_reminders"
      | "is_active",
    value: boolean
  ) => Promise<void>;
  onDispatchQueue: () => Promise<{ dispatched: number; mode: string }>;
  onSimulateWebhook: (payload: {
    type: "callback" | "command";
    callback_data?: string;
    command?: string;
    chat_id?: string;
  }) => Promise<{ statusHtml?: string; message?: string }>;
  onTestConnection: () => Promise<{
    configured: boolean;
    ok: boolean;
    botUsername?: string;
    detail: string;
  }>;
  onRegisterVercelWebhook: (baseUrl: string) => Promise<{
    ok: boolean;
    simulated: boolean;
    webhook_url: string;
    secret_configured: boolean;
    detail: string;
  }>;
}

export function TelegramConfigView({
  snapshot,
  onSaveRecipient,
  onToggleRecipientPermission,
  onDispatchQueue,
  onSimulateWebhook,
  onTestConnection,
  onRegisterVercelWebhook,
}: TelegramConfigViewProps) {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("CAREGIVER");
  const [chatId, setChatId] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionLog, setActionLog] = useState<string | null>(null);
  const [statusReportHtml, setStatusReportHtml] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deploymentBaseUrl, setDeploymentBaseUrl] = useState(
    "https://tu-proyecto.vercel.app"
  );

  useEffect(() => {
    if (typeof window !== "undefined" && window.location?.origin) {
      setDeploymentBaseUrl(window.location.origin);
    }
  }, []);

  async function handleAddRecipient(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !chatId.trim()) return;
    setSaving(true);
    try {
      await onSaveRecipient({
        full_name: fullName.trim(),
        role,
        telegram_chat_id: chatId.trim(),
        receive_med_reminders: true,
        receive_restock_alerts: true,
        receive_event_reminders: true,
        receive_topic_reminders: true,
      });
      setFullName("");
      setChatId("");
      setActionLog("[OK] Destinatario registrado en telegram_recipients.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRunDispatch() {
    setBusyAction("dispatch");
    try {
      const res = await onDispatchQueue();
      setActionLog(
        `[DESPACHADOR 60s] Procesadas ${res.dispatched} notificaciones (${res.mode}).`
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTestBot() {
    setBusyAction("test");
    try {
      const res = await onTestConnection();
      setActionLog(
        res.ok
          ? `[CONEXION BOT OK] Bot activo: @${res.botUsername ?? "desconocido"}. ${res.detail}`
          : `[ESTADO BOT] ${res.detail}`
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRegisterWebhook() {
    setBusyAction("webhook");
    try {
      const res = await onRegisterVercelWebhook(deploymentBaseUrl);
      setActionLog(
        `[WEBHOOK ${res.simulated ? "SIMULADO" : "REGISTRADO"}] ${res.webhook_url} | Secret Token: ${
          res.secret_configured ? "ACTIVO" : "NO CONFIGURADO"
        } | ${res.detail}`
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTestEstadoCommand() {
    setBusyAction("estado");
    try {
      const firstChatId =
        snapshot.telegram_recipients[0]?.telegram_chat_id ?? "100100002";
      const res = await onSimulateWebhook({
        type: "command",
        command: "/estado",
        chat_id: firstChatId,
      });
      if (res.statusHtml) {
        setStatusReportHtml(res.statusHtml);
      }
      setActionLog("[WEBHOOK /estado] Reporte clinico generado en HTML limpio.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSimulateCallback(notif: NotificationQueueItem, action: "ack" | "snooze") {
    setBusyAction(`${action}:${notif.id}`);
    try {
      const firstChatId =
        snapshot.telegram_recipients[0]?.telegram_chat_id ?? "100100002";
      const callbackData =
        action === "snooze"
          ? `snooze:${notif.id}:15`
          : notif.callback_action_payload || `ack_notif:${notif.id}`;
      const res = await onSimulateWebhook({
        type: "callback",
        callback_data: callbackData,
        chat_id: firstChatId,
      });
      setActionLog(
        res.message ??
          `[WEBHOOK CALLBACK] Accion ${callbackData} ejecutada correctamente.`
      );
    } finally {
      setBusyAction(null);
    }
  }

  function renderPermToggle(
    rec: TelegramRecipient,
    field:
      | "receive_med_reminders"
      | "receive_restock_alerts"
      | "receive_event_reminders"
      | "receive_topic_reminders"
      | "is_active",
    label: string
  ) {
    const checked = Boolean(rec[field]);
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${label} para ${rec.full_name}`}
        onClick={() => onToggleRecipientPermission(rec.id, field, !checked)}
        className={cn(
          "clinical-btn px-2.5 text-[13px] font-mono font-medium border",
          checked
            ? "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]"
            : "bg-[#F8FAFC] border-[#CBD5E1] text-[#64748B]"
        )}
      >
        {checked ? "[ACTIVO]" : "[INACTIVO]"}
      </button>
    );
  }

  return (
    <div className="space-y-6 clinical-enter">
      {/* Encabezado y Acciones de Conexion */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-[#0F172A]">
            Configuracion Bidireccional de Telegram Bot
          </h2>
          <p className="text-[14px] text-[#475569]">
            Destinatarios autorizados, matriz de alertas sin emojis, despachador
            transaccional y webhook interactivo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busyAction === "test"}
            onClick={handleTestBot}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            <ShieldCheck
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Probar Conexion Bot
          </button>

          <button
            type="button"
            disabled={busyAction === "estado"}
            onClick={handleTestEstadoCommand}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            <Terminal
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Probar Comando /estado
          </button>

          <button
            type="button"
            disabled={busyAction === "menu_tomas"}
            onClick={async () => {
              setBusyAction("menu_tomas");
              try {
                const firstChatId =
                  snapshot.telegram_recipients[0]?.telegram_chat_id ?? "100100002";
                const res = await onSimulateWebhook({
                  type: "command",
                  command: "[ Tomas de Hoy ]",
                  chat_id: firstChatId,
                });
                if (res.statusHtml) setStatusReportHtml(res.statusHtml);
                setActionLog("[MENU PACIENTE] Simulado boton [ Tomas de Hoy ].");
              } finally {
                setBusyAction(null);
              }
            }}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            Probar [ Tomas de Hoy ]
          </button>

          <button
            type="button"
            disabled={busyAction === "menu_restock"}
            onClick={async () => {
              setBusyAction("menu_restock");
              try {
                const firstChatId =
                  snapshot.telegram_recipients[0]?.telegram_chat_id ?? "100100002";
                const res = await onSimulateWebhook({
                  type: "command",
                  command: "[ Registrar Restock ]",
                  chat_id: firstChatId,
                });
                if (res.statusHtml) setStatusReportHtml(res.statusHtml);
                setActionLog("[MENU PACIENTE] Simulado boton [ Registrar Restock ].");
              } finally {
                setBusyAction(null);
              }
            }}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            Probar [ Registrar Restock ]
          </button>

          <button
            type="button"
            disabled={busyAction === "dispatch"}
            onClick={handleRunDispatch}
            className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
          >
            <Play className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            Ejecutar Despachador Ahora
          </button>
        </div>
      </div>

      {/* Estado de credenciales y log */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="clinical-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-[13px] font-medium text-[#475569]">
              Estado de TELEGRAM_BOT_TOKEN
            </span>
            <p className="mt-1 font-mono text-[14px] font-semibold text-[#0F172A]">
              {snapshot.telegram_configured
                ? "[CONFIGURADO] Envio en vivo a api.telegram.org"
                : "[MODO LOCAL] Simulacion controlada activa (sin token)"}
            </p>
          </div>
          <StatusBadge
            label={snapshot.telegram_configured ? "[EN VIVO]" : "[LOCAL]"}
            tone={snapshot.telegram_configured ? "ok" : "info"}
          />
        </div>

        <div className="clinical-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-[13px] font-medium text-[#475569]">
              Endpoint Webhook Interactivo
            </span>
            <p className="mt-1 font-mono text-[14px] text-[#0F172A]">
              POST /api/telegram/webhook (X-Telegram-Bot-Api-Secret-Token)
            </p>
          </div>
          <StatusBadge label="[ACTIVO]" tone="ok" />
        </div>
      </div>

      {/* Vinculacion de Webhook con Vercel + Configuracion de Cron Externo Hobby */}
      <section
        aria-labelledby="vercel-integration-heading"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <div className="clinical-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3
              id="vercel-integration-heading"
              className="text-[15px] font-bold text-[#0F172A]"
            >
              Registro Automatico de Webhook en Vercel
            </h3>
            <StatusBadge label="[REGION IAD1]" tone="info" />
          </div>
          <p className="text-[13px] text-[#475569]">
            Registra la ruta publica /api/telegram/webhook y su secret_token
            directamente ante la API de Telegram (setWebhook).
          </p>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="vercel-base-url"
                className="block text-[13px] font-medium text-[#0F172A] mb-1"
              >
                Dominio del despliegue en Vercel
              </label>
              <input
                id="vercel-base-url"
                type="url"
                value={deploymentBaseUrl}
                onChange={(e) => setDeploymentBaseUrl(e.target.value)}
                placeholder="https://tu-proyecto.vercel.app"
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>
            <button
              type="button"
              disabled={busyAction === "webhook"}
              onClick={handleRegisterWebhook}
              className="clinical-btn inline-flex items-center justify-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold whitespace-nowrap"
            >
              <Link2
                className="w-4 h-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {busyAction === "webhook"
                ? "Vinculando..."
                : "Vincular Webhook con Vercel"}
            </button>
          </div>
        </div>

        <div className="clinical-card p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-bold text-[#0F172A]">
              Cron Externo cada 60s (Plan Hobby Vercel)
            </h3>
            <StatusBadge label="[BEARER CRON_SECRET]" tone="warn" />
          </div>
          <p className="text-[13px] text-[#475569]">
            Configura cron-job.org o Cloudflare Workers Cron para invocar cada
            minuto el endpoint ligero de despacho transaccional:
          </p>
          <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px] font-mono text-[13px] text-[#0F172A] space-y-1 overflow-x-auto">
            <div>
              GET/POST {deploymentBaseUrl.replace(/\/+$/, "")}/api/cron/dispatch
            </div>
            <div className="text-[#475569]">
              Header: Authorization: Bearer &lt;CRON_SECRET&gt;
            </div>
          </div>
        </div>
      </section>

      {actionLog && (
        <div
          role="status"
          className="p-3.5 bg-[#ECFEFF] border border-[#A5F3FC] rounded-[6px] font-mono text-[14px] text-[#164E63]"
        >
          {actionLog}
        </div>
      )}

      {statusReportHtml && (
        <div className="clinical-card p-4 space-y-2 border-[#0E7490]">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-[#0F172A]">
              Respuesta HTML Generada para /estado (Cero Emojis)
            </h3>
            <button
              type="button"
              onClick={() => setStatusReportHtml(null)}
              className="text-[13px] text-[#475569] hover:underline"
            >
              Ocultar
            </button>
          </div>
          <pre className="p-3 bg-[#0F172A] text-[#F8FAFC] rounded-[6px] font-mono text-[13px] overflow-x-auto whitespace-pre-wrap">
            {statusReportHtml}
          </pre>
        </div>
      )}

      {/* Matriz de Destinatarios */}
      <section aria-labelledby="recipients-heading" className="space-y-4">
        <h3
          id="recipients-heading"
          className="text-[16px] font-bold text-[#0F172A]"
        >
          Matriz de Destinatarios Autorizados ({snapshot.telegram_recipients.length})
        </h3>

        <form
          onSubmit={handleAddRecipient}
          className="clinical-card p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label
              htmlFor="tg-name"
              className="block text-[13px] font-medium text-[#0F172A] mb-1"
            >
              Nombre completo
            </label>
            <input
              id="tg-name"
              type="text"
              required
              placeholder="Ej. Maria Dobrusin"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
            />
          </div>

          <div>
            <label
              htmlFor="tg-role"
              className="block text-[13px] font-medium text-[#0F172A] mb-1"
            >
              Rol clinico
            </label>
            <select
              id="tg-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
            >
              <option value="PATIENT">Paciente</option>
              <option value="PRIMARY_CAREGIVER">Cuidador Principal</option>
              <option value="FAMILY_MEMBER">Familiar</option>
              <option value="CAREGIVER">Cuidador</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="tg-chatid"
              className="block text-[13px] font-medium text-[#0F172A] mb-1"
            >
              Telegram Chat ID
            </label>
            <input
              id="tg-chatid"
              type="text"
              required
              placeholder="Ej. 519283746"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[15px] tabular-nums"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="clinical-btn inline-flex items-center justify-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
          >
            <UserPlus
              className="w-4 h-4"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            {saving ? "Guardando..." : "Agregar Destinatario"}
          </button>
        </form>

        <div className="clinical-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[13px] font-semibold text-[#475569]">
                  <th className="py-3 px-4">Nombre y Rol</th>
                  <th className="py-3 px-3">Chat ID</th>
                  <th className="py-3 px-3">Tomas Med.</th>
                  <th className="py-3 px-3">Restock &lt;= 7d</th>
                  <th className="py-3 px-3">Eventos Clinicos</th>
                  <th className="py-3 px-3">Temas Seg.</th>
                  <th className="py-3 px-4">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {snapshot.telegram_recipients.map((rec) => (
                  <tr key={rec.id} className="bg-white">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[15px] text-[#0F172A]">
                        {rec.full_name}
                      </div>
                      <div className="mt-0.5">
                        <StatusBadge
                          label={RECIPIENT_ROLE_TAG[rec.role] ?? `[${rec.role}]`}
                          tone="info"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[14px] tabular-nums text-[#0F172A]">
                      {rec.telegram_chat_id}
                    </td>
                    <td className="py-3 px-3">
                      {renderPermToggle(rec, "receive_med_reminders", "Tomas")}
                    </td>
                    <td className="py-3 px-3">
                      {renderPermToggle(rec, "receive_restock_alerts", "Restock")}
                    </td>
                    <td className="py-3 px-3">
                      {renderPermToggle(rec, "receive_event_reminders", "Eventos")}
                    </td>
                    <td className="py-3 px-3">
                      {renderPermToggle(rec, "receive_topic_reminders", "Temas")}
                    </td>
                    <td className="py-3 px-4">
                      {renderPermToggle(rec, "is_active", "Activo")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Cola Unificada de Notificaciones */}
      <section aria-labelledby="queue-heading" className="space-y-3">
        <h3 id="queue-heading" className="text-[16px] font-bold text-[#0F172A]">
          Cola Unificada de Notificaciones (Ultimas {snapshot.recent_notifications.length})
        </h3>

        <div className="space-y-3">
          {snapshot.recent_notifications.map((notif) => {
            const payloadLen = notif.callback_action_payload?.length ?? 0;
            return (
              <article
                key={notif.id}
                className="clinical-card p-4 space-y-2.5 bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={ALERT_STATUS_TAG[notif.status]}
                      tone={
                        notif.status === "ACKNOWLEDGED"
                          ? "ok"
                          : notif.status === "SENT"
                          ? "info"
                          : "warn"
                      }
                    />
                    <span className="font-mono text-[13px] font-semibold text-[#334155]">
                      [{notif.source_type}] [{notif.stage}]
                    </span>
                    <span className="font-bold text-[15px] text-[#0F172A]">
                      {notif.title}
                    </span>
                  </div>

                  <span className="font-mono text-[13px] text-[#475569] tabular-nums">
                    Programada: {formatDateTimeEs(notif.trigger_at)}
                  </span>
                </div>

                <pre className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px] font-mono text-[13px] text-[#0F172A] whitespace-pre-wrap overflow-x-auto">
                  {notif.message}
                </pre>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="font-mono text-[13px] text-[#64748B] tabular-nums">
                    Payload: {notif.callback_action_payload ?? "N/A"} (
                    {payloadLen}/64 bytes) | Reintentos: {notif.retry_count}
                    {notif.acknowledged_by_chat_id
                      ? ` | Confirmado por: ${notif.acknowledged_by_chat_id}`
                      : ""}
                  </span>

                  {notif.status !== "ACKNOWLEDGED" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {notif.source_type === "MEDICATION_INTAKE" && (
                        <button
                          type="button"
                          disabled={busyAction === `snooze:${notif.id}`}
                          onClick={() => handleSimulateCallback(notif, "snooze")}
                          className="clinical-btn px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px] font-medium"
                        >
                          Simular Posponer 15 min
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyAction === `ack:${notif.id}`}
                        onClick={() => handleSimulateCallback(notif, "ack")}
                        className="clinical-btn inline-flex items-center gap-1.5 px-3 bg-[#0E7490] hover:bg-[#155E75] text-white text-[13px] font-bold"
                      >
                        {notif.status === "QUEUED" ? (
                          <Send
                            className="w-3.5 h-3.5"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        ) : (
                          <CheckCircle2
                            className="w-3.5 h-3.5"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        )}
                        Simular Confirmacion Telegram
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
