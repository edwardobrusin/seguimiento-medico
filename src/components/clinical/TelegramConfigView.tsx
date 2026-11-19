"use client";

import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  BellRing,
  Check,
  Clock,
  Edit3,
  FileBarChart2,
  Globe,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Terminal,
  Trash2,
  Wifi,
} from "lucide-react";
import type {
  CommandCenterSnapshot,
  TelegramRecipient,
} from "@/lib/types/clinical";
import {
  ALERT_STAGE_SHORT,
  ALERT_STATUS_TAG,
  RECIPIENT_ROLE_TAG,
} from "@/lib/clinical-labels";
import { WEEKDAY_LABEL } from "@/lib/periodicity";
import { cn, formatDateTimeEs } from "@/lib/utils";
import { ClinicalModal } from "./ClinicalModal";
import { IconActionButton } from "./IconActionButton";
import { StatusBadge } from "./StatusBadge";

type ToggleField =
  | "receive_med_reminders"
  | "receive_restock_alerts"
  | "receive_event_reminders"
  | "receive_topic_reminders"
  | "receive_missed_block_alerts"
  | "receive_weekly_report"
  | "receive_change_alerts"
  | "is_active";

interface TelegramConfigViewProps {
  snapshot: CommandCenterSnapshot;
  onSaveRecipient: (payload: {
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
  }) => Promise<void>;
  onDeleteRecipient: (recipientId: string) => Promise<void>;
  onToggleRecipientPermission: (
    recipientId: string,
    field: ToggleField,
    value: boolean
  ) => Promise<void>;
  onRetryNotification: (notifId: string) => Promise<void>;
  onCancelNotification: (notifId: string) => Promise<void>;
  onDeleteNotification: (notifId: string) => Promise<void>;
  onPurgeAcknowledged: () => Promise<{ purgedCount: number }>;
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
  onUpdateMonitoringSettings: (payload: {
    timezone: string;
    missed_block_grace_mins: number;
    missed_block_alerts_enabled: boolean;
    weekly_report_enabled: boolean;
    weekly_report_day: number;
    weekly_report_hour: number;
    notify_admin_on_patient_change: boolean;
  }) => Promise<void>;
  onSendWeeklyReportNow: () => Promise<{
    dispatched: number;
    reportHtml: string;
  }>;
  onCheckMissedBlocksNow: () => Promise<{
    queued: number;
    dispatched: number;
    mode: string;
  }>;
}

const PERMISSION_COLUMNS: Array<{
  field: Exclude<ToggleField, "is_active">;
  label: string;
  adminOnly?: boolean;
}> = [
  { field: "receive_med_reminders", label: "Tomas" },
  { field: "receive_event_reminders", label: "Citas (-7/-3/-1/0d)" },
  { field: "receive_restock_alerts", label: "Stock <=7d", adminOnly: true },
  { field: "receive_topic_reminders", label: "Seguimiento", adminOnly: true },
  {
    field: "receive_missed_block_alerts",
    label: "Bloque atrasado",
    adminOnly: true,
  },
  {
    field: "receive_weekly_report",
    label: "Reporte semanal",
    adminOnly: true,
  },
  {
    field: "receive_change_alerts",
    label: "Cambios paciente",
    adminOnly: true,
  },
];

export function TelegramConfigView({
  snapshot,
  onSaveRecipient,
  onDeleteRecipient,
  onToggleRecipientPermission,
  onRetryNotification,
  onCancelNotification,
  onDeleteNotification,
  onPurgeAcknowledged,
  onDispatchQueue,
  onSimulateWebhook,
  onTestConnection,
  onRegisterVercelWebhook,
  onUpdateMonitoringSettings,
  onSendWeeklyReportNow,
  onCheckMissedBlocksNow,
}: TelegramConfigViewProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDeleteRecId, setConfirmDeleteRecId] = useState<string | null>(
    null
  );
  const [confirmDeleteNotifId, setConfirmDeleteNotifId] = useState<
    string | null
  >(null);

  // Destinatario Modal
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<TelegramRecipient | null>(null);
  const [rName, setRName] = useState("");
  const [rRole, setRRole] = useState("ADMIN");
  const [rChatId, setRChatId] = useState("");
  const [rMed, setRMed] = useState(false);
  const [rRestock, setRRestock] = useState(true);
  const [rEvent, setREvent] = useState(true);
  const [rTopic, setRTopic] = useState(true);
  const [rMissed, setRMissed] = useState(true);
  const [rWeekly, setRWeekly] = useState(true);
  const [rChanges, setRChanges] = useState(true);
  const [recError, setRecError] = useState<string | null>(null);
  const [savingRec, setSavingRec] = useState(false);

  // Monitoreo Modal
  const [monModalOpen, setMonModalOpen] = useState(false);
  const [mTimezone, setMTimezone] = useState("America/Mexico_City");
  const [mGrace, setMGrace] = useState("60");
  const [mMissedEnabled, setMMissedEnabled] = useState(true);
  const [mWeeklyEnabled, setMWeeklyEnabled] = useState(true);
  const [mWeeklyDay, setMWeeklyDay] = useState("0");
  const [mWeeklyHour, setMWeeklyHour] = useState("20");
  const [mChangeNotify, setMChangeNotify] = useState(true);
  const [monError, setMonError] = useState<string | null>(null);
  const [savingMon, setSavingMon] = useState(false);

  // Reporte / Simulador / Diagnostico
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>(
    "Vista Previa de Respuesta del Bot"
  );
  const [simChatId, setSimChatId] = useState<string>(
    snapshot.telegram_recipients[0]?.telegram_chat_id ?? "100100001"
  );
  const [webhookBaseUrl, setWebhookBaseUrl] = useState("");
  const [diagOutput, setDiagOutput] = useState<string | null>(null);

  const mon = snapshot.alert_monitoring_settings ?? {
    id: 1,
    timezone: "America/Mexico_City",
    missed_block_grace_mins: 60,
    missed_block_alerts_enabled: true,
    weekly_report_enabled: true,
    weekly_report_day: 0,
    weekly_report_hour: 20,
    notify_admin_on_patient_change: true,
    updated_at: snapshot.generated_at,
  };

  function applyRoleDefaults(nextRole: string) {
    setRRole(nextRole);
    if (nextRole === "PATIENT") {
      setRMed(true);
      setREvent(true);
      setRRestock(false);
      setRTopic(false);
      setRMissed(false);
      setRWeekly(false);
      setRChanges(false);
    } else {
      setRMed(false);
      setREvent(true);
      setRRestock(true);
      setRTopic(true);
      setRMissed(true);
      setRWeekly(true);
      setRChanges(true);
    }
  }

  function openCreateRecipient() {
    setEditingRec(null);
    setRName("");
    setRChatId("");
    applyRoleDefaults("ADMIN");
    setRecError(null);
    setRecModalOpen(true);
  }

  function openEditRecipient(rec: TelegramRecipient) {
    setEditingRec(rec);
    setRName(rec.full_name);
    setRRole(rec.role);
    setRChatId(rec.telegram_chat_id);
    setRMed(rec.receive_med_reminders);
    setRRestock(rec.receive_restock_alerts);
    setREvent(rec.receive_event_reminders);
    setRTopic(rec.receive_topic_reminders);
    setRMissed(rec.receive_missed_block_alerts);
    setRWeekly(rec.receive_weekly_report);
    setRChanges(rec.receive_change_alerts);
    setRecError(null);
    setRecModalOpen(true);
  }

  async function handleRecipientSubmit(e: FormEvent) {
    e.preventDefault();
    setRecError(null);
    if (!rName.trim() || !rChatId.trim()) {
      setRecError("Nombre y Chat ID son obligatorios.");
      return;
    }
    setSavingRec(true);
    try {
      await onSaveRecipient({
        ...(editingRec ? { recipient_id: editingRec.id } : {}),
        full_name: rName.trim(),
        role: rRole,
        telegram_chat_id: rChatId.trim(),
        receive_med_reminders: rMed,
        receive_restock_alerts: rRestock,
        receive_event_reminders: rEvent,
        receive_topic_reminders: rTopic,
        receive_missed_block_alerts: rMissed,
        receive_weekly_report: rWeekly,
        receive_change_alerts: rChanges,
      });
      setRecModalOpen(false);
    } catch (err) {
      setRecError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar el destinatario."
      );
    } finally {
      setSavingRec(false);
    }
  }

  function openMonitoringModal() {
    setMTimezone(mon.timezone || "America/Mexico_City");
    setMGrace(String(mon.missed_block_grace_mins));
    setMMissedEnabled(mon.missed_block_alerts_enabled);
    setMWeeklyEnabled(mon.weekly_report_enabled);
    setMWeeklyDay(String(mon.weekly_report_day));
    setMWeeklyHour(String(mon.weekly_report_hour));
    setMChangeNotify(mon.notify_admin_on_patient_change);
    setMonError(null);
    setMonModalOpen(true);
  }

  async function handleMonitoringSubmit(e: FormEvent) {
    e.preventDefault();
    setMonError(null);
    const grace = Number.parseInt(mGrace, 10);
    if (!Number.isFinite(grace) || grace < 10 || grace > 360) {
      setMonError("La tolerancia de bloque atrasado debe estar entre 10 y 360 minutos.");
      return;
    }
    const day = Number.parseInt(mWeeklyDay, 10);
    const hour = Number.parseInt(mWeeklyHour, 10);
    setSavingMon(true);
    try {
      await onUpdateMonitoringSettings({
        timezone: mTimezone.trim() || "America/Mexico_City",
        missed_block_grace_mins: grace,
        missed_block_alerts_enabled: mMissedEnabled,
        weekly_report_enabled: mWeeklyEnabled,
        weekly_report_day: Math.max(0, Math.min(6, day || 0)),
        weekly_report_hour: Math.max(0, Math.min(23, hour || 20)),
        notify_admin_on_patient_change: mChangeNotify,
      });
      setMonModalOpen(false);
    } catch (err) {
      setMonError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar la configuracion."
      );
    } finally {
      setSavingMon(false);
    }
  }

  return (
    <div className="space-y-5 clinical-enter">
      {/* Encabezado y Conexion */}
      <section className="clinical-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[20px] font-bold text-[#0F172A]">
                Gobernanza de Telegram Bot (Paciente vs Administradores)
              </h2>
              <StatusBadge
                label={
                  snapshot.telegram_configured
                    ? "[BOT CONFIGURADO]"
                    : "[MODO SIMULADO LOCAL]"
                }
                tone={snapshot.telegram_configured ? "ok" : "warn"}
              />
            </div>
            <p className="mt-1 text-[14px] text-[#475569]">
              Separacion estricta: el Paciente recibe recordatorios de tomas,
              registra restocks y consulta sus citas; los Administradores
              reciben alertas de bloques no tomados, reportes semanales de
              adherencia, avisos de cambios del paciente y stock critico.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IconActionButton
              icon={Wifi}
              label="Probar conexion con API de Telegram"
              shortLabel="Probar Bot"
              tone="neutral"
              loading={busyKey === "test-bot"}
              onClick={async () => {
                setBusyKey("test-bot");
                try {
                  const res = await onTestConnection();
                  setDiagOutput(res.detail);
                } catch {
                  // Toast
                } finally {
                  setBusyKey(null);
                }
              }}
            />

            <IconActionButton
              icon={Send}
              label="Despachar notificaciones en cola ahora"
              shortLabel="Despachar Cola"
              tone="info"
              loading={busyKey === "dispatch"}
              onClick={async () => {
                setBusyKey("dispatch");
                try {
                  const res = await onDispatchQueue();
                  setDiagOutput(
                    `Despacho completado (${res.mode}): ${res.dispatched} notificaciones enviadas.`
                  );
                } catch {
                  // Toast
                } finally {
                  setBusyKey(null);
                }
              }}
            />

            <IconActionButton
              icon={Plus}
              label="Agregar nuevo destinatario de Telegram"
              shortLabel="Nuevo Destinatario"
              tone="primary"
              onClick={openCreateRecipient}
            />
          </div>
        </div>

        {/* Registro de Webhook Vercel */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E2E8F0]">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
            <Globe className="w-4 h-4 text-[#0E7490] shrink-0" aria-hidden="true" />
            <label htmlFor="tg-webhook-url" className="sr-only">
              URL publica de Vercel para registrar webhook
            </label>
            <input
              id="tg-webhook-url"
              type="url"
              value={webhookBaseUrl}
              onChange={(e) => setWebhookBaseUrl(e.target.value)}
              placeholder="https://tu-proyecto.vercel.app (opcional, vacio usa URL actual)"
              className="clinical-input max-w-md flex-1 border border-[#CBD5E1] px-3 text-[13px] font-mono"
            />
            <button
              type="button"
              disabled={busyKey === "reg-webhook"}
              onClick={async () => {
                setBusyKey("reg-webhook");
                try {
                  const res = await onRegisterVercelWebhook(
                    webhookBaseUrl.trim() || window.location.origin
                  );
                  setDiagOutput(`${res.detail} (${res.webhook_url})`);
                } catch {
                  // Toast
                } finally {
                  setBusyKey(null);
                }
              }}
              className="clinical-btn px-3 border border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[13px] font-semibold text-[#0F172A]"
            >
              Registrar Webhook
            </button>
          </div>

          {diagOutput && (
            <span className="text-[12px] font-mono text-[#065F46] bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-1 rounded-[4px]">
              {diagOutput}
            </span>
          )}
        </div>
      </section>

      {/* Panel de Monitoreo Administrativo Automatico */}
      <section className="clinical-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <BellRing
              className="w-5 h-5 text-[#0E7490] shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <h3 className="text-[17px] font-bold text-[#0F172A]">
                Reglas de Monitoreo Administrativo y Reporte Semanal
              </h3>
              <p className="text-[13px] text-[#475569]">
                Vigila cuando un bloque horario no se marca como tomado a tiempo
                y genera el resumen semanal de comportamiento del paciente.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IconActionButton
              icon={Clock}
              label="Revisar bloques atrasados del dia ahora"
              shortLabel="Verificar Bloques Atrasados"
              tone="warn"
              loading={busyKey === "check-missed"}
              onClick={async () => {
                setBusyKey("check-missed");
                try {
                  const res = await onCheckMissedBlocksNow();
                  setDiagOutput(
                    `Evaluacion de bloques atrasados: ${res.queued} alertas nuevas encoladas, ${res.dispatched} enviadas.`
                  );
                } catch {
                  // Toast
                } finally {
                  setBusyKey(null);
                }
              }}
            />

            <IconActionButton
              icon={FileBarChart2}
              label="Generar y enviar reporte semanal de adherencia ahora"
              shortLabel="Enviar Reporte Semanal"
              tone="info"
              loading={busyKey === "send-weekly"}
              onClick={async () => {
                setBusyKey("send-weekly");
                try {
                  const res = await onSendWeeklyReportNow();
                  setPreviewTitle("Reporte Semanal Generado para Administradores");
                  setPreviewHtml(res.reportHtml);
                } catch {
                  // Toast
                } finally {
                  setBusyKey(null);
                }
              }}
            />

            <IconActionButton
              icon={Settings2}
              label="Configurar tolerancia de atraso y horario de reporte semanal"
              shortLabel="Configurar Reglas"
              tone="neutral"
              onClick={openMonitoringModal}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[13px]">
          <div className="p-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC]">
            <span className="text-[12px] text-[#64748B] block">
              Alerta &quot;No se marco como tomado&quot;
            </span>
            <strong className="text-[#0F172A]">
              {mon.missed_block_alerts_enabled
                ? `Activa (+${mon.missed_block_grace_mins} min de gracia)`
                : "Desactivada"}
            </strong>
          </div>

          <div className="p-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC]">
            <span className="text-[12px] text-[#64748B] block">
              Reporte semanal de comportamiento
            </span>
            <strong className="text-[#0F172A]">
              {mon.weekly_report_enabled
                ? `${WEEKDAY_LABEL[mon.weekly_report_day] ?? "Domingo"} a las ${String(mon.weekly_report_hour).padStart(2, "0")}:00`
                : "Desactivado"}
            </strong>
          </div>

          <div className="p-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC]">
            <span className="text-[12px] text-[#64748B] block">
              Aviso inmediato de cambios del paciente
            </span>
            <strong className="text-[#0F172A]">
              {mon.notify_admin_on_patient_change ? "Activo" : "Desactivado"}
            </strong>
          </div>

          <div className="p-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC]">
            <span className="text-[12px] text-[#64748B] block">
              Zona horaria clinica
            </span>
            <strong className="font-mono text-[#0F172A]">{mon.timezone}</strong>
          </div>
        </div>
      </section>

      {/* Tabla de Destinatarios y Permisos por Rol */}
      <section className="clinical-card p-5 space-y-3">
        <h3 className="text-[17px] font-bold text-[#0F172A]">
          Destinatarios Registrados ({snapshot.telegram_recipients.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[#475569] border-b border-[#E2E8F0]">
                <th className="py-2 pr-3 font-semibold">Destinatario / Rol</th>
                <th className="py-2 pr-3 font-semibold">Chat ID</th>
                {PERMISSION_COLUMNS.map((col) => (
                  <th
                    key={col.field}
                    className="py-2 px-2 font-semibold text-center"
                  >
                    {col.label}
                  </th>
                ))}
                <th className="py-2 px-2 font-semibold text-center">Activo</th>
                <th className="py-2 pl-2 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.telegram_recipients.map((rec) => {
                const isPatient = rec.role === "PATIENT";
                const isConfirmDel = confirmDeleteRecId === rec.id;
                return (
                  <tr
                    key={rec.id}
                    className="border-b border-[#F1F5F9] align-middle"
                  >
                    <td className="py-2.5 pr-3">
                      <p className="font-bold text-[#0F172A]">
                        {rec.full_name}
                      </p>
                      <StatusBadge
                        label={
                          RECIPIENT_ROLE_TAG[rec.role] ?? `[${rec.role}]`
                        }
                        tone={isPatient ? "ok" : "info"}
                      />
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[#334155]">
                      {rec.telegram_chat_id}
                    </td>
                    {PERMISSION_COLUMNS.map((col) => {
                      const checked = Boolean(rec[col.field]);
                      const disabledForPatient = isPatient && col.adminOnly;
                      const key = `tog:${rec.id}:${col.field}`;
                      return (
                        <td
                          key={col.field}
                          className="py-2.5 px-2 text-center"
                        >
                          <input
                            type="checkbox"
                            checked={!disabledForPatient && checked}
                            disabled={
                              disabledForPatient || busyKey === key
                            }
                            aria-label={`${col.label} para ${rec.full_name}`}
                            onChange={(e) => {
                              setBusyKey(key);
                              onToggleRecipientPermission(
                                rec.id,
                                col.field,
                                e.target.checked
                              ).finally(() => setBusyKey(null));
                            }}
                            className="w-4 h-4 accent-[#0E7490] cursor-pointer disabled:opacity-35"
                          />
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={rec.is_active}
                        disabled={busyKey === `tog:${rec.id}:is_active`}
                        aria-label={`Activar destinatario ${rec.full_name}`}
                        onChange={(e) => {
                          const key = `tog:${rec.id}:is_active`;
                          setBusyKey(key);
                          onToggleRecipientPermission(
                            rec.id,
                            "is_active",
                            e.target.checked
                          ).finally(() => setBusyKey(null));
                        }}
                        className="w-4 h-4 accent-[#0E7490] cursor-pointer"
                      />
                    </td>
                    <td className="py-2.5 pl-2">
                      <div className="flex items-center justify-end gap-2">
                        <IconActionButton
                          icon={Edit3}
                          label={`Editar destinatario ${rec.full_name}`}
                          tone="neutral"
                          onClick={() => openEditRecipient(rec)}
                        />
                        {isConfirmDel ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyKey === `del-rec:${rec.id}`}
                              onClick={async () => {
                                setBusyKey(`del-rec:${rec.id}`);
                                try {
                                  await onDeleteRecipient(rec.id);
                                  setConfirmDeleteRecId(null);
                                } catch {
                                  // Toast
                                } finally {
                                  setBusyKey(null);
                                }
                              }}
                              className="clinical-btn px-2.5 bg-[#991B1B] text-white text-[12px] font-bold"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteRecId(null)}
                              className="clinical-btn px-2 border border-[#CBD5E1] bg-white text-[#334155] text-[12px]"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <IconActionButton
                            icon={Trash2}
                            label={`Eliminar destinatario ${rec.full_name}`}
                            tone="danger"
                            onClick={() => setConfirmDeleteRecId(rec.id)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Simulador Interactivo de Comandos por Rol */}
      <section className="clinical-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-[#0E7490]" aria-hidden="true" />
            <h3 className="text-[16px] font-bold text-[#0F172A]">
              Simulador de Interaccion en Telegram (Por Perfil de Chat)
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="sim-chat-select"
              className="text-[12px] font-semibold text-[#475569]"
            >
              Simular como:
            </label>
            <select
              id="sim-chat-select"
              value={simChatId}
              onChange={(e) => setSimChatId(e.target.value)}
              className="clinical-input border border-[#CBD5E1] px-3 text-[13px] bg-white"
            >
              {snapshot.telegram_recipients.map((r) => (
                <option key={r.id} value={r.telegram_chat_id}>
                  {r.full_name} ({r.role === "PATIENT" ? "PACIENTE" : "ADMIN"})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            ["/start", "Menu / Teclado"],
            ["/medicinas", "Tomas de Hoy"],
            ["/restock", "Registrar Restock"],
            ["/citas", "Proximas Citas"],
            ["/inventario", "Inventario"],
            ["/reporte", "Reporte Semanal (Solo Admin)"],
            ["/cambios", "Cambios Paciente (Solo Admin)"],
          ].map(([cmd, label]) => (
            <button
              key={cmd}
              type="button"
              disabled={busyKey === `sim:${cmd}`}
              onClick={async () => {
                setBusyKey(`sim:${cmd}`);
                try {
                  const res = await onSimulateWebhook({
                    type: "command",
                    command: cmd,
                    chat_id: simChatId,
                  });
                  setPreviewTitle(`Respuesta del Bot a ${cmd}`);
                  setPreviewHtml(
                    res.statusHtml ?? res.message ?? "Comando procesado."
                  );
                } catch {
                  // Toast
                } finally {
                  setBusyKey(null);
                }
              }}
              className="clinical-btn px-3 border border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[13px] font-mono text-[#0F172A]"
            >
              {cmd} - {label}
            </button>
          ))}
        </div>
      </section>

      {/* Cola de Notificaciones */}
      <section className="clinical-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[17px] font-bold text-[#0F172A]">
            Cola de Notificaciones ({snapshot.recent_notifications.length})
          </h3>
          <button
            type="button"
            disabled={busyKey === "purge"}
            onClick={async () => {
              setBusyKey("purge");
              try {
                await onPurgeAcknowledged();
              } catch {
                // Toast
              } finally {
                setBusyKey(null);
              }
            }}
            className="clinical-btn px-3 border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-[13px] font-medium text-[#334155]"
          >
            Limpiar Confirmadas
          </button>
        </div>

        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {snapshot.recent_notifications.map((n) => {
            const isConfirmDel = confirmDeleteNotifId === n.id;
            return (
              <div
                key={n.id}
                className="p-3.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={ALERT_STATUS_TAG[n.status]}
                      tone={
                        n.status === "ACKNOWLEDGED"
                          ? "ok"
                          : n.status === "SENT"
                          ? "info"
                          : "warn"
                      }
                    />
                    <StatusBadge
                      label={`[${n.source_type}]`}
                      tone="neutral"
                    />
                    <StatusBadge
                      label={ALERT_STAGE_SHORT[n.stage] ?? n.stage}
                      tone="neutral"
                    />
                    <span className="font-bold text-[14px] text-[#0F172A]">
                      {n.title}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#64748B] font-mono tabular-nums">
                    Programada: {formatDateTimeEs(n.trigger_at)}
                    {n.sent_at ? ` | Enviada: ${formatDateTimeEs(n.sent_at)}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <IconActionButton
                    icon={RefreshCw}
                    label={`Reintentar envio de ${n.title}`}
                    tone="info"
                    loading={busyKey === `retry:${n.id}`}
                    onClick={async () => {
                      setBusyKey(`retry:${n.id}`);
                      try {
                        await onRetryNotification(n.id);
                      } catch {
                        // Toast
                      } finally {
                        setBusyKey(null);
                      }
                    }}
                  />
                  {n.status !== "ACKNOWLEDGED" && (
                    <IconActionButton
                      icon={Check}
                      label={`Marcar como atendida: ${n.title}`}
                      tone="success"
                      loading={busyKey === `ack:${n.id}`}
                      onClick={async () => {
                        setBusyKey(`ack:${n.id}`);
                        try {
                          await onCancelNotification(n.id);
                        } catch {
                          // Toast
                        } finally {
                          setBusyKey(null);
                        }
                      }}
                    />
                  )}
                  {isConfirmDel ? (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyKey === `del-n:${n.id}`}
                        onClick={async () => {
                          setBusyKey(`del-n:${n.id}`);
                          try {
                            await onDeleteNotification(n.id);
                            setConfirmDeleteNotifId(null);
                          } catch {
                            // Toast
                          } finally {
                            setBusyKey(null);
                          }
                        }}
                        className="clinical-btn px-2.5 bg-[#991B1B] text-white text-[12px] font-bold"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteNotifId(null)}
                        className="clinical-btn px-2 border border-[#CBD5E1] bg-white text-[#334155] text-[12px]"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <IconActionButton
                      icon={Trash2}
                      label={`Eliminar notificacion ${n.title}`}
                      tone="danger"
                      onClick={() => setConfirmDeleteNotifId(n.id)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Modal: Destinatario */}
      <ClinicalModal
        open={recModalOpen}
        onClose={() => !savingRec && setRecModalOpen(false)}
        title={
          editingRec
            ? `Editar Destinatario: ${editingRec.full_name}`
            : "Registrar Destinatario de Telegram"
        }
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleRecipientSubmit} className="space-y-4">
          {recError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px] flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{recError}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="rc-name"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Nombre completo *
            </label>
            <input
              id="rc-name"
              type="text"
              required
              value={rName}
              onChange={(e) => setRName(e.target.value)}
              className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="rc-role"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Nivel de acceso en Telegram
              </label>
              <select
                id="rc-role"
                value={rRole}
                onChange={(e) => applyRoleDefaults(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
              >
                <option value="PATIENT">Paciente (Tomas, Restock y Citas)</option>
                <option value="ADMIN">Administrador (Monitoreo Completo)</option>
                <option value="PRIMARY_CAREGIVER">Cuidador Principal (Admin)</option>
                <option value="FAMILY_MEMBER">Familiar Responsable (Admin)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="rc-chat"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Telegram Chat ID *
              </label>
              <input
                id="rc-chat"
                type="text"
                required
                value={rChatId}
                onChange={(e) => setRChatId(e.target.value)}
                placeholder="Ej. 123456789"
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
          </div>

          {!editingRec && (
            <div className="p-3.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] space-y-2 text-[13px]">
              <p className="font-semibold text-[#0F172A]">
                Suscripciones iniciales:
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rMed}
                  onChange={(e) => setRMed(e.target.checked)}
                  className="w-4 h-4 accent-[#0E7490]"
                />
                Recordatorios de bloques de toma
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rEvent}
                  onChange={(e) => setREvent(e.target.checked)}
                  className="w-4 h-4 accent-[#0E7490]"
                />
                Recordatorios de citas (-7d, -3d, -1d, hoy)
              </label>
              {rRole !== "PATIENT" && (
                <>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rMissed}
                      onChange={(e) => setRMissed(e.target.checked)}
                      className="w-4 h-4 accent-[#0E7490]"
                    />
                    Alerta cuando un bloque no se marque como tomado
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rWeekly}
                      onChange={(e) => setRWeekly(e.target.checked)}
                      className="w-4 h-4 accent-[#0E7490]"
                    />
                    Reporte semanal del comportamiento del paciente
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rRestock}
                      onChange={(e) => setRRestock(e.target.checked)}
                      className="w-4 h-4 accent-[#0E7490]"
                    />
                    Niveles criticos de stock en medicinas (&lt;= 7d)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rChanges}
                      onChange={(e) => setRChanges(e.target.checked)}
                      className="w-4 h-4 accent-[#0E7490]"
                    />
                    Avisos cuando el paciente registre restock o cambios
                  </label>
                </>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setRecModalOpen(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingRec}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold"
            >
              {savingRec ? "Guardando..." : "Guardar Destinatario"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Configurar Monitoreo Administrativo */}
      <ClinicalModal
        open={monModalOpen}
        onClose={() => !savingMon && setMonModalOpen(false)}
        title="Configurar Reglas de Monitoreo Administrativo"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleMonitoringSubmit} className="space-y-4">
          {monError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
            >
              {monError}
            </div>
          )}

          <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
            <input
              type="checkbox"
              checked={mMissedEnabled}
              onChange={(e) => setMMissedEnabled(e.target.checked)}
              className="w-4 h-4 accent-[#0E7490]"
            />
            Enviar alerta a administradores cuando no se marque un bloque como tomado
          </label>

          <div>
            <label
              htmlFor="mon-grace"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Minutos de tolerancia despues de la hora del bloque (10 - 360)
            </label>
            <input
              id="mon-grace"
              type="number"
              min="10"
              max="360"
              value={mGrace}
              onChange={(e) => setMGrace(e.target.value)}
              className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
            <input
              type="checkbox"
              checked={mWeeklyEnabled}
              onChange={(e) => setMWeeklyEnabled(e.target.checked)}
              className="w-4 h-4 accent-[#0E7490]"
            />
            Enviar reporte semanal automatico de adherencia y comportamiento
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="mon-day"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Dia del reporte semanal
              </label>
              <select
                id="mon-day"
                value={mWeeklyDay}
                onChange={(e) => setMWeeklyDay(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px] bg-white"
              >
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_LABEL[d]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="mon-hour"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Hora del reporte (0 - 23h)
              </label>
              <input
                id="mon-hour"
                type="number"
                min="0"
                max="23"
                value={mWeeklyHour}
                onChange={(e) => setMWeeklyHour(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A] cursor-pointer">
            <input
              type="checkbox"
              checked={mChangeNotify}
              onChange={(e) => setMChangeNotify(e.target.checked)}
              className="w-4 h-4 accent-[#0E7490]"
            />
            Notificar a administradores cuando el paciente edite o haga restock
          </label>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setMonModalOpen(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingMon}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold"
            >
              {savingMon ? "Guardando..." : "Guardar Reglas"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Vista Previa HTML del Bot / Reporte Semanal */}
      <ClinicalModal
        open={Boolean(previewHtml)}
        onClose={() => setPreviewHtml(null)}
        title={previewTitle}
        maxWidthClass="max-w-2xl"
      >
        <div
          className={cn(
            "p-4 rounded-[6px] bg-[#0F172A] text-[#F8FAFC] font-mono text-[13px] whitespace-pre-wrap leading-relaxed"
          )}
          dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }}
        />
      </ClinicalModal>
    </div>
  );
}
