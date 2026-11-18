import { query, withTransaction } from "@/lib/db/client";
import {
  EVENT_CATEGORY_TAG,
  INTAKE_RULE_LABEL,
  PRIORITY_TAG,
  TASK_STATUS_TAG,
} from "@/lib/clinical-labels";
import type {
  AlertStage,
  AlertStatus,
  EventCategory,
  IntakeConstraint,
  TaskStatus,
  TelegramRecipient,
} from "@/lib/types/clinical";

export interface TelegramUpdatePayload {
  update_id?: number;
  message?: {
    message_id?: number;
    from?: {
      id: number | string;
      first_name?: string;
      username?: string;
    };
    chat: {
      id: number | string;
      type?: string;
    };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number | string;
      first_name?: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number | string;
      };
      text?: string;
    };
    data?: string;
  };
}

export interface UpsertRecipientInput {
  full_name: string;
  role?: string;
  telegram_chat_id: string;
  receive_med_reminders?: boolean;
  receive_restock_alerts?: boolean;
  receive_event_reminders?: boolean;
  receive_topic_reminders?: boolean;
  is_active?: boolean;
}

export type RecipientToggleField =
  | "receive_med_reminders"
  | "receive_restock_alerts"
  | "receive_event_reminders"
  | "receive_topic_reminders"
  | "is_active";

type QueuedNotificationRow = {
  id: string;
  source_type: string;
  source_id: string;
  stage: AlertStage;
  trigger_at: string;
  status: AlertStatus;
  title: string;
  message: string;
  callback_action_payload: string | null;
  retry_count: number;
};

type TelegramRecipientRow = TelegramRecipient & Record<string, unknown>;

interface DeliveredMessageRef {
  chat_id: string;
  message_id: number;
  simulated?: boolean;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOGGLEABLE_COLUMNS: Record<RecipientToggleField, string> = {
  receive_med_reminders: "receive_med_reminders",
  receive_restock_alerts: "receive_restock_alerts",
  receive_event_reminders: "receive_event_reminders",
  receive_topic_reminders: "receive_topic_reminders",
  is_active: "is_active",
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token ? token : null;
}

function normalizeHttpOrigin(raw: string): string {
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
    throw new Error(
      "URL base invalida: solo se permiten protocolos http:// o https://."
    );
  }
  return `https://${raw}`;
}

function recipientMatchesSourceType(
  recipient: TelegramRecipient,
  sourceType: string
): boolean {
  switch (sourceType) {
    case "MEDICATION_INTAKE":
      return recipient.receive_med_reminders;
    case "RESTOCK_ALERT":
      return recipient.receive_restock_alerts;
    case "CLINICAL_EVENT":
      return recipient.receive_event_reminders;
    case "FOLLOW_UP_DEADLINE":
      return recipient.receive_topic_reminders;
    default:
      return true;
  }
}

async function callTelegramApi<T = unknown>(
  token: string,
  method: string,
  payload?: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.description || `Telegram API error HTTP ${res.status}`);
  }
  return { ok: true, result: data.result };
}

export class TelegramNotificationService {
  static formatClusterMedicationHtml(
    label: string,
    timeHHMM: string,
    items: Array<{ name: string; dose: string; ruleLabel: string }>,
    statusLabel: string
  ): string {
    const headerTitle = (label.trim() || "BLOQUE DE MEDICACION").toUpperCase();
    const itemLines = items.map(
      (item, idx) =>
        `<b>${idx + 1}. ${escapeHtml(item.name)}</b> | Dosis: ${escapeHtml(item.dose)} | Regla: ${escapeHtml(item.ruleLabel)}`
    );
    return [
      `<b>[${escapeHtml(headerTitle)} - ${escapeHtml(timeHHMM)}]</b>`,
      "----------------------------------------",
      ...itemLines,
      "----------------------------------------",
      `Estado: ${escapeHtml(statusLabel.trim() || "PENDIENTE DE CONFIRMACION")}`,
    ].join("\n");
  }

  static buildInlineKeyboard(notif: {
    id: string;
    source_type: string;
    callback_action_payload: string | null;
  }): {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  } {
    const ackCallback = (
      notif.callback_action_payload || `ack_notif:${notif.id}`
    ).slice(0, 64);

    if (notif.source_type === "MEDICATION_INTAKE") {
      return {
        inline_keyboard: [
          [
            {
              text: "[ Confirmar Bloque Tomado ]",
              callback_data: ackCallback,
            },
            {
              text: "[ Posponer 15 min ]",
              callback_data: `snooze:${notif.id}:15`.slice(0, 64),
            },
          ],
        ],
      };
    }

    return {
      inline_keyboard: [
        [
          {
            text: "[ Confirmar Recepcion ]",
            callback_data: ackCallback,
          },
        ],
      ],
    };
  }

  static async dispatchQueuedNotifications(): Promise<{
    dispatched: number;
    failed: number;
    mode: "LIVE_TELEGRAM" | "SIMULATED_LOCAL";
  }> {
    const botToken = getBotToken();
    const mode: "LIVE_TELEGRAM" | "SIMULATED_LOCAL" = botToken
      ? "LIVE_TELEGRAM"
      : "SIMULATED_LOCAL";

    return withTransaction(async (tx) => {
      const queueRes = await tx.query<QueuedNotificationRow>(
        `SELECT *
         FROM notification_queue
         WHERE status = 'QUEUED'
           AND trigger_at <= NOW()
           AND retry_count < 5
         ORDER BY trigger_at ASC
         LIMIT 50
         FOR UPDATE SKIP LOCKED`
      );

      if (queueRes.rows.length === 0) {
        return { dispatched: 0, failed: 0, mode };
      }

      const recipientsRes = await tx.query<TelegramRecipientRow>(
        `SELECT *
         FROM telegram_recipients
         WHERE is_active = TRUE
         ORDER BY created_at ASC`
      );
      const activeRecipients = recipientsRes.rows;

      let dispatched = 0;
      let failed = 0;
      let simOffset = 0;

      for (const notif of queueRes.rows) {
        const targets = activeRecipients.filter((r) =>
          recipientMatchesSourceType(r, notif.source_type)
        );

        if (targets.length === 0) {
          await tx.query(
            `UPDATE notification_queue
             SET retry_count = retry_count + 1,
                 last_error = $2
             WHERE id = $1`,
            [
              notif.id,
              `Sin destinatarios activos habilitados para ${notif.source_type}.`,
            ]
          );
          failed += 1;
          continue;
        }

        const htmlBody = `<b>${escapeHtml(notif.title)}</b>\n${notif.message}`;
        const replyMarkup = this.buildInlineKeyboard(notif);
        const delivered: DeliveredMessageRef[] = [];
        const errors: string[] = [];

        for (const recipient of targets) {
          if (botToken) {
            try {
              const resp = await callTelegramApi<{ message_id: number }>(
                botToken,
                "sendMessage",
                {
                  chat_id: recipient.telegram_chat_id,
                  text: htmlBody,
                  parse_mode: "HTML",
                  reply_markup: replyMarkup,
                }
              );
              if (resp.result?.message_id !== undefined) {
                delivered.push({
                  chat_id: recipient.telegram_chat_id,
                  message_id: resp.result.message_id,
                });
              }
            } catch (err) {
              const detail =
                err instanceof Error ? err.message : "Error desconocido";
              errors.push(`${recipient.telegram_chat_id}: ${detail}`);
            }
          } else {
            delivered.push({
              chat_id: recipient.telegram_chat_id,
              message_id: Math.floor(Date.now() / 1000) + simOffset,
              simulated: true,
            });
            simOffset += 1;
          }
        }

        if (delivered.length > 0) {
          await tx.query(
            `UPDATE notification_queue
             SET telegram_message_ids = $2::jsonb,
                 status = 'SENT',
                 sent_at = NOW(),
                 last_error = $3
             WHERE id = $1`,
            [
              notif.id,
              JSON.stringify(delivered),
              errors.length > 0 ? errors.join(" | ") : null,
            ]
          );
          dispatched += 1;
        } else {
          await tx.query(
            `UPDATE notification_queue
             SET retry_count = retry_count + 1,
                 last_error = $2
             WHERE id = $1`,
            [notif.id, errors.join(" | ") || "Fallo al enviar notificacion."]
          );
          failed += 1;
        }
      }

      return { dispatched, failed, mode };
    });
  }

  static async generateEstadoHtml(): Promise<string> {
    const todayStr = new Date().toISOString().slice(0, 10);

    const [pendingRes, lowStockRes, eventsRes, topicsRes] = await Promise.all([
      query<{
        cluster_id: string | null;
        cluster_label: string | null;
        anchor_time: string | null;
        med_name: string;
        quantity_deducted: number;
        presentation: string;
        intake_rule: IntakeConstraint;
      }>(
        `SELECT
           il.cluster_id,
           ic.label AS cluster_label,
           COALESCE(ic.anchor_time::text, (il.scheduled_for AT TIME ZONE 'UTC')::time::text) AS anchor_time,
           m.name AS med_name,
           il.quantity_deducted::float8 AS quantity_deducted,
           m.presentation,
           m.intake_rule
         FROM intake_logs il
         JOIN medications m ON m.id = il.medication_id
         LEFT JOIN intake_clusters ic ON ic.id = il.cluster_id
         WHERE (il.scheduled_for AT TIME ZONE 'UTC')::date = $1::date
           AND il.status = 'PENDING'
         ORDER BY anchor_time ASC, m.name ASC`,
        [todayStr]
      ),
      query<{
        name: string;
        current_stock: number;
        presentation: string;
        days_of_supply_remaining: number;
      }>(
        `SELECT
           name,
           current_stock::float8 AS current_stock,
           presentation,
           days_of_supply_remaining::float8 AS days_of_supply_remaining
         FROM medications
         WHERE is_active = TRUE
           AND days_of_supply_remaining <= 7
         ORDER BY days_of_supply_remaining ASC, name ASC`
      ),
      query<{
        title: string;
        category: EventCategory;
        event_datetime: string;
        specialist_or_center: string | null;
      }>(
        `SELECT title, category, event_datetime::text AS event_datetime, specialist_or_center
         FROM clinical_events
         WHERE is_completed = FALSE
         ORDER BY event_datetime ASC
         LIMIT 5`
      ),
      query<{
        title: string;
        status: TaskStatus;
        priority: number;
        progress_percentage: number;
        deadline_at: string;
      }>(
        `SELECT title, status, priority, progress_percentage, deadline_at::text AS deadline_at
         FROM follow_up_topics
         WHERE status != 'COMPLETED'
         ORDER BY priority ASC, deadline_at ASC
         LIMIT 5`
      ),
    ]);

    const groupedBlocks = new Map<
      string,
      { label: string; timeHHMM: string; items: string[] }
    >();
    for (const row of pendingRes.rows) {
      const key = row.cluster_id ?? "UNCLUSTERED";
      const timeHHMM = (row.anchor_time ?? "00:00").slice(0, 5);
      const label = row.cluster_label ?? "Tomas Individuales";
      const existing = groupedBlocks.get(key) ?? { label, timeHHMM, items: [] };
      existing.items.push(
        `  - ${escapeHtml(row.med_name)} | ${row.quantity_deducted} ${escapeHtml(row.presentation)} | ${escapeHtml(INTAKE_RULE_LABEL[row.intake_rule])}`
      );
      groupedBlocks.set(key, existing);
    }

    const lines: string[] = [
      `<b>[ESTADO CLINICO CONSOLIDADO - ${escapeHtml(todayStr)}]</b>`,
      "========================================",
      "<b>1. BLOQUES PENDIENTES HOY</b>",
    ];

    if (groupedBlocks.size === 0) {
      lines.push("<code>[OK] Sin tomas pendientes para hoy.</code>");
    } else {
      for (const block of groupedBlocks.values()) {
        lines.push(
          `<code>[${escapeHtml(block.timeHHMM)}]</code> <b>${escapeHtml(block.label)}</b>`
        );
        lines.push(...block.items);
      }
    }

    lines.push("----------------------------------------");
    lines.push("<b>2. INVENTARIO CRITICO (&lt;= 7 DIAS)</b>");
    if (lowStockRes.rows.length === 0) {
      lines.push("<code>[OK] Cobertura farmacologica estable.</code>");
    } else {
      for (const med of lowStockRes.rows) {
        lines.push(
          `<code>[CRITICO]</code> <b>${escapeHtml(med.name)}</b> | Stock: ${med.current_stock} ${escapeHtml(med.presentation)} | Restante: ${med.days_of_supply_remaining} d`
        );
      }
    }

    lines.push("----------------------------------------");
    lines.push("<b>3. PROXIMOS EVENTOS CLINICOS (TOP 5)</b>");
    if (eventsRes.rows.length === 0) {
      lines.push("<code>[SIN EVENTOS] No hay eventos pendientes.</code>");
    } else {
      for (const evt of eventsRes.rows) {
        const dt = evt.event_datetime.slice(0, 16).replace("T", " ");
        const spec = evt.specialist_or_center
          ? ` | ${escapeHtml(evt.specialist_or_center)}`
          : "";
        lines.push(
          `<code>${escapeHtml(EVENT_CATEGORY_TAG[evt.category])}</code> <b>${escapeHtml(evt.title)}</b> | ${escapeHtml(dt)}${spec}`
        );
      }
    }

    lines.push("----------------------------------------");
    lines.push("<b>4. TEMAS DE SEGUIMIENTO ABIERTOS (TOP 5)</b>");
    if (topicsRes.rows.length === 0) {
      lines.push("<code>[SIN TEMAS] No hay gestiones abiertas.</code>");
    } else {
      for (const topic of topicsRes.rows) {
        const dl = topic.deadline_at.slice(0, 10);
        const prio = PRIORITY_TAG[topic.priority] ?? `[P${topic.priority}]`;
        lines.push(
          `<code>${escapeHtml(prio)}</code> <b>${escapeHtml(topic.title)}</b> | ${escapeHtml(TASK_STATUS_TAG[topic.status])} | ${topic.progress_percentage}% | Limite: ${escapeHtml(dl)}`
        );
      }
    }

    lines.push("========================================");
    return lines.join("\n");
  }

  static async handleWebhookUpdate(
    update: TelegramUpdatePayload,
    secretTokenHeader?: string | null,
    options?: { skipSecretCheck?: boolean }
  ): Promise<{
    ok: boolean;
    unauthorized?: boolean;
    action?: string;
    message?: string;
    statusHtml?: string;
  }> {
    const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!options?.skipSecretCheck && configuredSecret) {
      if (secretTokenHeader !== configuredSecret) {
        return {
          ok: false,
          unauthorized: true,
          message: "Invalid webhook secret token",
        };
      }
    }

    const botToken = getBotToken();

    if (update.callback_query) {
      const cq = update.callback_query;
      const data = (cq.data ?? "").trim();
      const fromId = String(cq.from.id);
      const parts = data.split(":");
      const prefix = parts[0] ?? "";

      const answerSafe = async (text: string) => {
        if (!botToken || !cq.id || cq.id.startsWith("sim_")) return;
        try {
          await callTelegramApi(botToken, "answerCallbackQuery", {
            callback_query_id: cq.id,
            text,
          });
        } catch {
          // No interrumpir confirmacion en base de datos si Telegram rechaza respuesta efimera
        }
      };

      if (prefix === "ack_cluster" && parts[1] && parts[2]) {
        const clusterId = parts[1];
        const dateStr = parts[2];

        const { DoseClusteringService } = await import(
          "./dose-clustering.service"
        );
        const result = await DoseClusteringService.confirmClusterIntake(
          clusterId,
          dateStr,
          fromId
        );

        await query(
          `UPDATE notification_queue
           SET status = 'ACKNOWLEDGED',
               acknowledged_at = NOW(),
               acknowledged_by_chat_id = $3
           WHERE (
             (source_type = 'MEDICATION_INTAKE' AND source_id = $1::uuid AND idempotency_key = $2)
             OR callback_action_payload = $4
           )
             AND status != 'ACKNOWLEDGED'`,
          [clusterId, `CLUSTER_${clusterId}_${dateStr}`, fromId, data]
        );

        const now = new Date();
        const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;

        if (botToken && cq.message?.chat?.id !== undefined && cq.message?.message_id) {
          const baseText = cq.message.text ?? "[BLOQUE DE MEDICACION]";
          try {
            await callTelegramApi(botToken, "editMessageText", {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: `${baseText}\n<code>[CONFIRMADO VIA TELEGRAM - ${hhmm}]</code>`,
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: [] },
            });
          } catch {
            // Mantener exito si el mensaje de prueba no existe en Telegram
          }
        }

        await answerSafe("[CONFIRMADO] Bloque registrado como tomado.");
        return {
          ok: true,
          action: "ack_cluster",
          message: `[CONFIRMADO] Bloque ${clusterId} (${dateStr}) confirmado (${result.updatedCount} tomas actualizadas).`,
        };
      }

      if (prefix === "snooze" && parts[1]) {
        const notifId = parts[1];
        const minsParsed = Number(parts[2] ?? "15");
        const mins =
          Number.isFinite(minsParsed) && minsParsed > 0
            ? Math.min(1440, Math.round(minsParsed))
            : 15;

        if (UUID_REGEX.test(notifId)) {
          await query(
            `UPDATE notification_queue
             SET trigger_at = NOW() + ($2 || ' minutes')::INTERVAL,
                 status = 'QUEUED'
             WHERE id = $1::uuid`,
            [notifId, String(mins)]
          );
        }

        await answerSafe(`[POSPUESTO] Recordatorio reprogramado +${mins} min.`);
        return {
          ok: true,
          action: "snooze",
          message: `[POSPUESTO] Notificacion ${notifId} reprogramada +${mins} minutos.`,
        };
      }

      if (prefix === "ack_restock" && parts[1]) {
        const medId = parts[1];
        if (UUID_REGEX.test(medId)) {
          await query(
            `UPDATE notification_queue
             SET status = 'ACKNOWLEDGED',
                 acknowledged_at = NOW(),
                 acknowledged_by_chat_id = $2
             WHERE source_type = 'RESTOCK_ALERT'
               AND source_id = $1::uuid
               AND status != 'ACKNOWLEDGED'`,
            [medId, fromId]
          );
        }

        await answerSafe("[CONFIRMADO] Alerta de restock reconocida.");
        return {
          ok: true,
          action: "ack_restock",
          message: `[CONFIRMADO] Alertas de restock para ${medId} marcadas como ACKNOWLEDGED.`,
        };
      }

      if (prefix === "ack_notif" && parts[1]) {
        const sourceOrId = parts[1];
        if (UUID_REGEX.test(sourceOrId)) {
          await query(
            `UPDATE notification_queue
             SET status = 'ACKNOWLEDGED',
                 acknowledged_at = NOW(),
                 acknowledged_by_chat_id = $3
             WHERE (id = $1::uuid OR callback_action_payload = $2)
               AND status != 'ACKNOWLEDGED'`,
            [sourceOrId, data, fromId]
          );
        } else {
          await query(
            `UPDATE notification_queue
             SET status = 'ACKNOWLEDGED',
                 acknowledged_at = NOW(),
                 acknowledged_by_chat_id = $2
             WHERE callback_action_payload = $1
               AND status != 'ACKNOWLEDGED'`,
            [data, fromId]
          );
        }

        await answerSafe("[CONFIRMADO] Recepcion registrada.");
        return {
          ok: true,
          action: "ack_notif",
          message: `[CONFIRMADO] Notificacion (${data}) marcada como ACKNOWLEDGED.`,
        };
      }

      await answerSafe("[INFO] Accion procesada.");
      return {
        ok: true,
        action: "ignored",
        message: "Callback sin accion reconocida.",
      };
    }

    const msgText = update.message?.text?.trim() ?? "";
    if (msgText.startsWith("/estado") && update.message?.chat) {
      const statusHtml = await this.generateEstadoHtml();
      if (botToken) {
        try {
          await callTelegramApi(botToken, "sendMessage", {
            chat_id: update.message.chat.id,
            text: statusHtml,
            parse_mode: "HTML",
          });
        } catch {
          // Permitir retorno de statusHtml en pruebas simuladas
        }
      }
      return {
        ok: true,
        action: "estado",
        message: "[ESTADO] Reporte clinico generado.",
        statusHtml,
      };
    }

    return {
      ok: true,
      action: "noop",
      message: "Actualizacion de webhook recibida.",
    };
  }

  static async upsertRecipient(
    input: UpsertRecipientInput
  ): Promise<TelegramRecipient> {
    const res = await query<TelegramRecipientRow>(
      `INSERT INTO telegram_recipients (
         full_name, role, telegram_chat_id,
         receive_med_reminders, receive_restock_alerts,
         receive_event_reminders, receive_topic_reminders, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (telegram_chat_id) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           receive_med_reminders = EXCLUDED.receive_med_reminders,
           receive_restock_alerts = EXCLUDED.receive_restock_alerts,
           receive_event_reminders = EXCLUDED.receive_event_reminders,
           receive_topic_reminders = EXCLUDED.receive_topic_reminders,
           is_active = EXCLUDED.is_active
       RETURNING *`,
      [
        input.full_name.trim(),
        (input.role ?? "CAREGIVER").trim(),
        input.telegram_chat_id.trim(),
        input.receive_med_reminders ?? true,
        input.receive_restock_alerts ?? true,
        input.receive_event_reminders ?? true,
        input.receive_topic_reminders ?? true,
        input.is_active ?? true,
      ]
    );
    return res.rows[0];
  }

  static async toggleRecipientField(
    recipientId: string,
    field: RecipientToggleField,
    value: boolean
  ): Promise<TelegramRecipient> {
    const column = TOGGLEABLE_COLUMNS[field];
    if (!column) {
      throw new Error(`Campo de permiso no permitido: ${String(field)}`);
    }
    const res = await query<TelegramRecipientRow>(
      `UPDATE telegram_recipients
       SET ${column} = $2
       WHERE id = $1::uuid
       RETURNING *`,
      [recipientId, value]
    );
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Destinatario de Telegram no encontrado.");
    }
    return updated;
  }

  static async testBotConnection(): Promise<{
    configured: boolean;
    ok: boolean;
    botUsername?: string;
    detail: string;
  }> {
    const token = getBotToken();
    if (!token) {
      return {
        configured: false,
        ok: false,
        detail:
          "TELEGRAM_BOT_TOKEN no configurado. Modo simulacion local activo.",
      };
    }

    try {
      const resp = await callTelegramApi<{
        username?: string;
        first_name?: string;
      }>(token, "getMe");
      return {
        configured: true,
        ok: true,
        botUsername: resp.result?.username,
        detail: "Conexion verificada con Telegram Bot API.",
      };
    } catch (err) {
      return {
        configured: true,
        ok: false,
        detail:
          err instanceof Error
            ? err.message
            : "Error al verificar conexion con Telegram Bot API.",
      };
    }
  }

  /**
   * Registers or validates the Vercel webhook endpoint with Telegram Bot API.
   */
  static async registerVercelWebhook(baseUrl?: string): Promise<{
    ok: boolean;
    simulated: boolean;
    webhook_url: string;
    secret_configured: boolean;
    detail: string;
  }> {
    const rawCandidate =
      baseUrl?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
      process.env.VERCEL_URL?.trim() ||
      "http://localhost:3000";

    const origin = normalizeHttpOrigin(rawCandidate);

    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error(`URL base invalida para webhook: ${origin}`);
    }
    if (
      parsedOrigin.protocol !== "http:" &&
      parsedOrigin.protocol !== "https:"
    ) {
      throw new Error(
        "URL base invalida: solo se permiten protocolos http:// o https://."
      );
    }

    const cleanedOrigin = origin.replace(/\/+$/, "");
    const webhookUrl = cleanedOrigin.endsWith("/api/telegram/webhook")
      ? cleanedOrigin
      : `${cleanedOrigin}/api/telegram/webhook`;

    let parsedWebhook: URL;
    try {
      parsedWebhook = new URL(webhookUrl);
    } catch {
      throw new Error(`URL de webhook invalida: ${webhookUrl}`);
    }
    if (!parsedWebhook.hostname) {
      throw new Error(`URL de webhook sin host valido: ${webhookUrl}`);
    }

    const token = getBotToken();
    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined;

    if (!token) {
      return {
        ok: true,
        simulated: true,
        webhook_url: webhookUrl,
        secret_configured: Boolean(secretToken),
        detail:
          "TELEGRAM_BOT_TOKEN no configurado: URL validada en modo local. Configura el token en Vercel y vuelve a vincular.",
      };
    }

    await callTelegramApi(token, "setWebhook", {
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
    });

    return {
      ok: true,
      simulated: false,
      webhook_url: webhookUrl,
      secret_configured: Boolean(secretToken),
      detail: "Webhook registrado exitosamente en Telegram Bot API.",
    };
  }
}
