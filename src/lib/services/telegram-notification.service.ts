import { query, withTransaction, type DbExecutor } from "@/lib/db/client";
import { safeRevalidateHome } from "@/lib/vercel-cache";
import {
  EVENT_CATEGORY_TAG,
  INTAKE_RULE_LABEL,
  PRIORITY_TAG,
  TASK_STATUS_TAG,
} from "@/lib/clinical-labels";
import { GovernanceAuditService } from "./governance-audit.service";
import type {
  AlertStage,
  AlertStatus,
  EventCategory,
  IntakeConstraint,
  IntakeStatus,
  TaskStatus,
  TelegramRecipient,
} from "@/lib/types/clinical";

export const PATIENT_PERSISTENT_KEYBOARD = {
  keyboard: [
    [{ text: "[ Tomas de Hoy ]" }, { text: "[ Registrar Restock ]" }],
    [{ text: "[ Proximas Citas ]" }, { text: "[ Estado de Inventario ]" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

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

type QueryExecutor = Pick<DbExecutor, "query">;

type QueuedNotificationRow = {
  id: string;
  source_type: string;
  source_id: string;
  stage: AlertStage;
  trigger_at: string;
  trigger_date_utc: string;
  status: AlertStatus;
  title: string;
  message: string;
  callback_action_payload: string | null;
  telegram_message_ids: unknown;
  idempotency_key: string;
  retry_count: number;
};

type TelegramRecipientRow = TelegramRecipient & Record<string, unknown>;

interface DeliveredMessageRef {
  chat_id: string;
  message_id: number;
  simulated?: boolean;
}

interface InlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

type TelegramReplyMarkup =
  | InlineKeyboardMarkup
  | typeof PATIENT_PERSISTENT_KEYBOARD;

interface ClusterStateItem {
  name: string;
  dose: string;
  ruleLabel: string;
  status: IntakeStatus;
}

interface ClusterPendingItem {
  intake_log_id: string;
  medication_name: string;
}

interface ClusterStateSummary {
  label: string;
  timeHHMM: string;
  anchorTime: string;
  items: ClusterStateItem[];
  pendingItems: ClusterPendingItem[];
  takenCount: number;
  totalCount: number;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_STR_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

function truncateCallbackData(raw: string, maxBytes = 64): string {
  if (Buffer.byteLength(raw, "utf8") <= maxBytes) {
    return raw;
  }
  let out = "";
  for (const ch of raw) {
    if (Buffer.byteLength(out + ch, "utf8") > maxBytes) {
      break;
    }
    out += ch;
  }
  return out;
}

function formatUtcHHMM(date = new Date()): string {
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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

function parseDeliveredMessageRefs(raw: unknown): DeliveredMessageRef[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const refs: DeliveredMessageRef[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const chatId =
      rec.chat_id !== undefined && rec.chat_id !== null
        ? String(rec.chat_id)
        : "";
    const messageId =
      typeof rec.message_id === "number"
        ? rec.message_id
        : Number(rec.message_id);
    if (chatId && Number.isFinite(messageId)) {
      refs.push({
        chat_id: chatId,
        message_id: messageId,
        ...(rec.simulated === true ? { simulated: true } : {}),
      });
    }
  }
  return refs;
}

function mergeDeliveredMessageRefs(
  existing: DeliveredMessageRef[],
  additions: DeliveredMessageRef[]
): DeliveredMessageRef[] {
  const byKey = new Map<string, DeliveredMessageRef>();
  for (const ref of existing) {
    byKey.set(`${ref.chat_id}:${ref.message_id}`, ref);
  }
  for (const ref of additions) {
    byKey.set(`${ref.chat_id}:${ref.message_id}`, ref);
  }
  return Array.from(byKey.values());
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

async function sendTelegramMessageSafe(
  botToken: string | null,
  chatId: string | number,
  text: string,
  replyMarkup?: TelegramReplyMarkup,
  simOffset = 0
): Promise<DeliveredMessageRef | null> {
  if (!botToken) {
    return {
      chat_id: String(chatId),
      message_id: Math.floor(Date.now() / 1000) + simOffset,
      simulated: true,
    };
  }
  try {
    const resp = await callTelegramApi<{ message_id: number }>(
      botToken,
      "sendMessage",
      {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }
    );
    if (resp.result?.message_id !== undefined) {
      return {
        chat_id: String(chatId),
        message_id: resp.result.message_id,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function editTelegramMessageSafe(
  botToken: string | null,
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  if (!botToken) return;
  try {
    await callTelegramApi(botToken, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  } catch {
    // Mantener exito si Telegram rechaza edicion (mensaje sin cambios o simulado)
  }
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

  static formatClusterStateHtml(
    label: string,
    timeHHMM: string,
    items: Array<{ name: string; dose: string; ruleLabel: string; status: string }>,
    footerStatus: string
  ): string {
    const headerTitle = (label.trim() || "BLOQUE DE MEDICACION").toUpperCase();
    const itemLines = items.map((item, idx) => {
      const statusTag =
        item.status === "TAKEN"
          ? "[CONFIRMADO]"
          : item.status === "DELAYED"
          ? "[POSPUESTO]"
          : item.status === "SKIPPED"
          ? "[OMITIDO]"
          : "[PENDIENTE]";
      return `<code>${statusTag}</code> <b>${idx + 1}. ${escapeHtml(item.name)}</b> | Dosis: ${escapeHtml(item.dose)} | Regla: ${escapeHtml(item.ruleLabel)}`;
    });

    return [
      `<b>[${escapeHtml(headerTitle)} - ${escapeHtml(timeHHMM)}]</b>`,
      "----------------------------------------",
      ...itemLines,
      "----------------------------------------",
      `Estado: ${escapeHtml(footerStatus.trim() || "PENDIENTE DE CONFIRMACION")}`,
    ].join("\n");
  }

  static buildClusterInlineKeyboard(
    notifId: string,
    clusterId: string,
    dateStr: string,
    pendingItems: Array<{ intake_log_id: string; medication_name: string }>
  ): InlineKeyboardMarkup {
    const itemRows = pendingItems.map((item) => [
      {
        text: `[ Tomar: ${item.medication_name.slice(0, 28)} ]`,
        callback_data: truncateCallbackData(`ack_log:${item.intake_log_id}`),
      },
    ]);

    return {
      inline_keyboard: [
        [
          {
            text: "[ Confirmar Bloque Completo ]",
            callback_data: truncateCallbackData(
              `ack_cluster:${clusterId}:${dateStr}`
            ),
          },
        ],
        ...itemRows,
        [
          {
            text: "[ Posponer Bloque 15 min ]",
            callback_data: truncateCallbackData(`snooze:${notifId}:15`),
          },
        ],
      ],
    };
  }

  static buildRestockInlineKeyboard(
    medId: string,
    unitsPerPackage: number
  ): InlineKeyboardMarkup {
    const pkg = Math.max(1, Math.round(unitsPerPackage || 30));
    return {
      inline_keyboard: [
        [
          {
            text: `[ +1 Envase/Caja (+${pkg}) ]`,
            callback_data: truncateCallbackData(`restock_add:${medId}:${pkg}`),
          },
          {
            text: `[ +2 Envases/Cajas (+${pkg * 2}) ]`,
            callback_data: truncateCallbackData(
              `restock_add:${medId}:${pkg * 2}`
            ),
          },
        ],
        [
          {
            text: "[ +10 Unidades ]",
            callback_data: truncateCallbackData(`restock_add:${medId}:10`),
          },
          {
            text: "[ +5 Unidades ]",
            callback_data: truncateCallbackData(`restock_add:${medId}:5`),
          },
        ],
      ],
    };
  }

  static buildInlineKeyboard(notif: {
    id: string;
    source_type: string;
    callback_action_payload: string | null;
  }): InlineKeyboardMarkup {
    const ackCallback = truncateCallbackData(
      notif.callback_action_payload || `ack_notif:${notif.id}`
    );

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
              callback_data: truncateCallbackData(`snooze:${notif.id}:15`),
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

  private static async getClusterStateForDate(
    clusterId: string,
    dateStr: string,
    executor: QueryExecutor = { query }
  ): Promise<ClusterStateSummary | null> {
    const res = await executor.query<{
      intake_log_id: string;
      status: IntakeStatus;
      med_name: string;
      quantity_deducted: number;
      presentation: string;
      intake_rule: IntakeConstraint;
      cluster_label: string | null;
      anchor_time: string | null;
    }>(
      `SELECT
         il.id AS intake_log_id,
         il.status,
         m.name AS med_name,
         il.quantity_deducted::float8 AS quantity_deducted,
         m.presentation,
         m.intake_rule,
         ic.label AS cluster_label,
         ic.anchor_time::text AS anchor_time
       FROM intake_logs il
       JOIN medications m ON m.id = il.medication_id
       LEFT JOIN intake_clusters ic ON ic.id = il.cluster_id
       WHERE il.cluster_id = $1::uuid
         AND (il.scheduled_for AT TIME ZONE 'UTC')::date = $2::date
       ORDER BY m.name ASC`,
      [clusterId, dateStr]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const first = res.rows[0];
    const anchorTime = first.anchor_time ?? "00:00:00";
    const timeHHMM = anchorTime.slice(0, 5);
    const label = first.cluster_label ?? "BLOQUE DE MEDICACION";

    const items: ClusterStateItem[] = [];
    const pendingItems: ClusterPendingItem[] = [];
    let takenCount = 0;

    for (const row of res.rows) {
      items.push({
        name: row.med_name,
        dose: `${row.quantity_deducted} ${row.presentation}`,
        ruleLabel: INTAKE_RULE_LABEL[row.intake_rule],
        status: row.status,
      });
      if (row.status === "PENDING") {
        pendingItems.push({
          intake_log_id: row.intake_log_id,
          medication_name: row.med_name,
        });
      }
      if (row.status === "TAKEN") {
        takenCount += 1;
      }
    }

    return {
      label,
      timeHHMM,
      anchorTime,
      items,
      pendingItems,
      takenCount,
      totalCount: res.rows.length,
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
        `SELECT *,
           (trigger_at AT TIME ZONE 'UTC')::date::text AS trigger_date_utc
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
        let htmlBody = `<b>${escapeHtml(notif.title)}</b>\n${notif.message}`;
        let replyMarkup: InlineKeyboardMarkup;
        let updatedMessageText: string | null = null;

        if (notif.source_type === "MEDICATION_INTAKE") {
          const triggerDate =
            notif.trigger_date_utc || new Date().toISOString().slice(0, 10);
          const clusterState = await this.getClusterStateForDate(
            notif.source_id,
            triggerDate,
            tx
          );

          if (!clusterState || clusterState.pendingItems.length === 0) {
            await tx.query(
              `UPDATE notification_queue
               SET status = 'ACKNOWLEDGED',
                   acknowledged_at = COALESCE(acknowledged_at, NOW()),
                   acknowledged_by_chat_id = COALESCE(acknowledged_by_chat_id, 'SYSTEM_ALREADY_TAKEN')
               WHERE id = $1`,
              [notif.id]
            );
            continue;
          }

          const footerStatus =
            clusterState.takenCount > 0
              ? `CONFIRMADO PARCIAL (${clusterState.takenCount}/${clusterState.totalCount})`
              : "PENDIENTE DE CONFIRMACION";

          htmlBody = this.formatClusterStateHtml(
            clusterState.label,
            clusterState.timeHHMM,
            clusterState.items,
            footerStatus
          );
          updatedMessageText = htmlBody;
          replyMarkup = this.buildClusterInlineKeyboard(
            notif.id,
            notif.source_id,
            triggerDate,
            clusterState.pendingItems
          );
        } else if (notif.source_type === "RESTOCK_ALERT") {
          const medRes = await tx.query<{ units_per_package: number }>(
            `SELECT units_per_package::float8 AS units_per_package
             FROM medications
             WHERE id = $1::uuid`,
            [notif.source_id]
          );
          const unitsPerPackage = Number(
            medRes.rows[0]?.units_per_package ?? 30
          );
          replyMarkup = this.buildRestockInlineKeyboard(
            notif.source_id,
            unitsPerPackage
          );
        } else {
          replyMarkup = this.buildInlineKeyboard(notif);
        }

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
          const existingRefs = parseDeliveredMessageRefs(
            notif.telegram_message_ids
          );
          const mergedRefs = mergeDeliveredMessageRefs(existingRefs, delivered);

          await tx.query(
            `UPDATE notification_queue
             SET telegram_message_ids = $2::jsonb,
                 status = 'SENT',
                 sent_at = NOW(),
                 last_error = $3,
                 message = COALESCE($4, message)
             WHERE id = $1`,
            [
              notif.id,
              JSON.stringify(mergedRefs),
              errors.length > 0 ? errors.join(" | ") : null,
              updatedMessageText,
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

    const [pendingRes, lowStockRes, pendingDataRes, eventsRes, topicsRes] = await Promise.all([
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
           AND m.is_active = TRUE
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
           AND days_of_supply_remaining IS NOT NULL
           AND days_of_supply_remaining <= 7
         ORDER BY days_of_supply_remaining ASC, name ASC`
      ),
      query<{
        name: string;
        current_stock: number | null;
        package_price: number | null;
        units_per_package: number | null;
      }>(
        `SELECT
           name,
           current_stock::float8 AS current_stock,
           package_price::float8 AS package_price,
           units_per_package::float8 AS units_per_package
         FROM medications
         WHERE is_active = TRUE
           AND (current_stock IS NULL OR package_price IS NULL OR units_per_package IS NULL)
         ORDER BY name ASC`
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

    if (pendingDataRes.rows.length > 0) {
      lines.push("----------------------------------------");
      lines.push("<b>5. FARMACOS CON DATOS PENDIENTES</b>");
      for (const pm of pendingDataRes.rows) {
        const missing: string[] = [];
        if (pm.current_stock === null) missing.push("Stock");
        if (pm.package_price === null) missing.push("Precio");
        if (pm.units_per_package === null) missing.push("Envase");
        lines.push(
          `<code>[PENDIENTE]</code> <b>${escapeHtml(pm.name)}</b> | Faltan: ${escapeHtml(missing.join(", "))}`
        );
      }
    }

    lines.push("========================================");
    return lines.join("\n");
  }

  static async syncClusterStateFromWeb(
    clusterId: string,
    dateStr: string
  ): Promise<void> {
    if (!UUID_REGEX.test(clusterId) || !DATE_STR_REGEX.test(dateStr)) {
      return;
    }

    const idempotencyKey = `CLUSTER_${clusterId}_${dateStr}`;
    const notifRes = await query<{
      id: string;
      telegram_message_ids: unknown;
    }>(
      `SELECT id, telegram_message_ids
       FROM notification_queue
       WHERE source_type = 'MEDICATION_INTAKE'
         AND source_id = $1::uuid
         AND idempotency_key = $2
       LIMIT 1`,
      [clusterId, idempotencyKey]
    );

    const notif = notifRes.rows[0];
    if (!notif) {
      return;
    }

    const clusterState = await this.getClusterStateForDate(clusterId, dateStr);
    if (!clusterState) {
      return;
    }

    let syncedHtml: string;
    let replyMarkup: InlineKeyboardMarkup;

    if (clusterState.pendingItems.length > 0) {
      const footerStatus =
        clusterState.takenCount > 0
          ? `CONFIRMADO PARCIAL (${clusterState.takenCount}/${clusterState.totalCount})`
          : "PENDIENTE DE CONFIRMACION";

      syncedHtml = this.formatClusterStateHtml(
        clusterState.label,
        clusterState.timeHHMM,
        clusterState.items,
        footerStatus
      );
      replyMarkup = this.buildClusterInlineKeyboard(
        notif.id,
        clusterId,
        dateStr,
        clusterState.pendingItems
      );

      await query(
        `UPDATE notification_queue
         SET message = $2
         WHERE id = $1::uuid`,
        [notif.id, syncedHtml]
      );
    } else {
      syncedHtml = `${this.formatClusterStateHtml(
        clusterState.label,
        clusterState.timeHHMM,
        clusterState.items,
        "CONFIRMADO"
      )}\n<code>[ACTUALIZADO DESDE EL PANEL WEB]</code>`;
      replyMarkup = { inline_keyboard: [] };

      await query(
        `UPDATE notification_queue
         SET message = $2,
             status = 'ACKNOWLEDGED',
             acknowledged_at = COALESCE(acknowledged_at, NOW()),
             acknowledged_by_chat_id = COALESCE(acknowledged_by_chat_id, 'CONSOLA_WEB')
         WHERE id = $1::uuid`,
        [notif.id, syncedHtml]
      );
    }

    const botToken = getBotToken();
    const refs = parseDeliveredMessageRefs(notif.telegram_message_ids);
    if (!botToken || refs.length === 0) {
      return;
    }

    for (const ref of refs) {
      if (ref.simulated) continue;
      await editTelegramMessageSafe(
        botToken,
        ref.chat_id,
        ref.message_id,
        syncedHtml,
        replyMarkup
      );
    }
  }

  static async syncRestockFromWeb(
    medication: {
      id: string;
      name: string;
      presentation: string;
      current_stock: number;
      days_of_supply_remaining: number;
    },
    notifications: Array<{
      id: string;
      title: string;
      message: string;
      telegram_message_ids: unknown;
    }>
  ): Promise<void> {
    if (notifications.length === 0) {
      return;
    }

    const botToken = getBotToken();

    for (const notif of notifications) {
      const updatedHtml = [
        `<b>${escapeHtml(notif.title)}</b>`,
        `Inventario actualizado: ${medication.current_stock} (${escapeHtml(medication.presentation)}) | Cobertura: ${medication.days_of_supply_remaining} dias.`,
        "<code>[ACTUALIZADO DESDE EL PANEL WEB]</code>",
      ].join("\n");

      await query(
        `UPDATE notification_queue
         SET message = $2
         WHERE id = $1::uuid`,
        [notif.id, updatedHtml]
      );

      const refs = parseDeliveredMessageRefs(notif.telegram_message_ids);
      if (!botToken || refs.length === 0) {
        continue;
      }

      for (const ref of refs) {
        if (ref.simulated) continue;
        await editTelegramMessageSafe(
          botToken,
          ref.chat_id,
          ref.message_id,
          updatedHtml,
          { inline_keyboard: [] }
        );
      }
    }
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
      const isSimulatedCallback = cq.id?.startsWith("sim_") ?? false;

      const answerSafe = async (text: string) => {
        if (!botToken || !cq.id || isSimulatedCallback) return;
        try {
          await callTelegramApi(botToken, "answerCallbackQuery", {
            callback_query_id: cq.id,
            text,
          });
        } catch {
          // No interrumpir confirmacion en base de datos si Telegram rechaza respuesta efimera
        }
      };

      const editCurrentMessageSafe = async (
        text: string,
        replyMarkup?: InlineKeyboardMarkup
      ) => {
        if (
          !botToken ||
          isSimulatedCallback ||
          cq.message?.chat?.id === undefined ||
          !cq.message?.message_id
        ) {
          return;
        }
        await editTelegramMessageSafe(
          botToken,
          cq.message.chat.id,
          cq.message.message_id,
          text,
          replyMarkup
        );
      };

      if (prefix === "ack_cluster" && parts[1] && parts[2]) {
        const clusterId = parts[1];
        const dateStr = parts[2];

        if (!UUID_REGEX.test(clusterId) || !DATE_STR_REGEX.test(dateStr)) {
          await answerSafe("[ERROR] Identificador de bloque invalido.");
          return {
            ok: true,
            action: "ignored",
            message: "Identificador de bloque o fecha invalido.",
          };
        }

        const { DoseClusteringService } = await import(
          "./dose-clustering.service"
        );
        const result = await DoseClusteringService.confirmClusterIntake(
          clusterId,
          dateStr,
          fromId,
          { origin: "TELEGRAM" }
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

        const hhmm = formatUtcHHMM();
        const clusterState = await this.getClusterStateForDate(
          clusterId,
          dateStr
        );
        const statusHtml = clusterState
          ? `${this.formatClusterStateHtml(
              clusterState.label,
              clusterState.timeHHMM,
              clusterState.items,
              "CONFIRMADO"
            )}\n<code>[CONFIRMADO VIA TELEGRAM - ${hhmm}]</code>`
          : `${escapeHtml(
              cq.message?.text ?? "[BLOQUE DE MEDICACION]"
            )}\n<code>[CONFIRMADO VIA TELEGRAM - ${hhmm}]</code>`;

        await query(
          `UPDATE notification_queue
           SET message = $2
           WHERE source_type = 'MEDICATION_INTAKE'
             AND source_id = $1::uuid
             AND idempotency_key = $3`,
          [clusterId, statusHtml, `CLUSTER_${clusterId}_${dateStr}`]
        );

        await editCurrentMessageSafe(statusHtml, { inline_keyboard: [] });
        await answerSafe("[CONFIRMADO] Bloque registrado como tomado.");
        return {
          ok: true,
          action: "ack_cluster",
          message: `[CONFIRMADO] Bloque ${clusterId} (${dateStr}) confirmado (${result.updatedCount} tomas actualizadas).`,
          statusHtml,
        };
      }

      if (prefix === "ack_log" && parts[1]) {
        const intakeLogId = parts[1];
        if (!UUID_REGEX.test(intakeLogId)) {
          await answerSafe("[ERROR] Identificador de toma invalido.");
          return {
            ok: true,
            action: "ignored",
            message: "Identificador de toma invalido.",
          };
        }

        const updateRes = await query<{
          cluster_id: string | null;
          date_str: string;
        }>(
          `UPDATE intake_logs
           SET status = 'TAKEN',
               taken_at = NOW(),
               recorded_by = $2
           WHERE id = $1::uuid
             AND status = 'PENDING'
           RETURNING cluster_id, (scheduled_for AT TIME ZONE 'UTC')::date::text AS date_str`,
          [intakeLogId, fromId]
        );

        const wasNewlyTaken = updateRes.rows.length > 0;
        let logMeta = updateRes.rows[0];

        if (!logMeta) {
          const existingRes = await query<{
            cluster_id: string | null;
            date_str: string;
          }>(
            `SELECT cluster_id, (scheduled_for AT TIME ZONE 'UTC')::date::text AS date_str
             FROM intake_logs
             WHERE id = $1::uuid
             LIMIT 1`,
            [intakeLogId]
          );
          logMeta = existingRes.rows[0];
        }

        if (!logMeta) {
          await answerSafe("[INFO] Registro de toma no encontrado.");
          return {
            ok: true,
            action: "ignored",
            message: "Registro de toma no encontrado.",
          };
        }

        if (!logMeta.cluster_id) {
          const hhmm = formatUtcHHMM();
          const statusHtml = `<b>[TOMA INDIVIDUAL CONFIRMADA]</b>\n<code>[CONFIRMADO VIA TELEGRAM - ${hhmm}]</code>`;
          await editCurrentMessageSafe(statusHtml, { inline_keyboard: [] });
          await answerSafe(
            wasNewlyTaken
              ? "[CONFIRMADO] Toma registrada."
              : "[INFO] Toma ya registrada previamente."
          );
          return {
            ok: true,
            action: "ack_log_completed",
            message: `[CONFIRMADO] Toma ${intakeLogId} confirmada.`,
            statusHtml,
          };
        }

        const clusterId = logMeta.cluster_id;
        const dateStr = logMeta.date_str;
        const idempotencyKey = `CLUSTER_${clusterId}_${dateStr}`;

        const [clusterState, notifRes] = await Promise.all([
          this.getClusterStateForDate(clusterId, dateStr),
          query<{ id: string }>(
            `SELECT id
             FROM notification_queue
             WHERE source_type = 'MEDICATION_INTAKE'
               AND source_id = $1::uuid
               AND idempotency_key = $2
             LIMIT 1`,
            [clusterId, idempotencyKey]
          ),
        ]);

        if (!clusterState) {
          await answerSafe("[INFO] Bloque de toma sincronizado.");
          return {
            ok: true,
            action: "ignored",
            message: "No se encontraron tomas asociadas al bloque.",
          };
        }

        const notifId = notifRes.rows[0]?.id ?? clusterId;

        if (clusterState.pendingItems.length > 0) {
          const footerStatus =
            clusterState.takenCount > 0
              ? `CONFIRMADO PARCIAL (${clusterState.takenCount}/${clusterState.totalCount})`
              : "PENDIENTE DE CONFIRMACION";

          const statusHtml = this.formatClusterStateHtml(
            clusterState.label,
            clusterState.timeHHMM,
            clusterState.items,
            footerStatus
          );
          const replyMarkup = this.buildClusterInlineKeyboard(
            notifId,
            clusterId,
            dateStr,
            clusterState.pendingItems
          );

          if (notifRes.rows[0]?.id) {
            await query(
              `UPDATE notification_queue
               SET message = $2
               WHERE id = $1::uuid`,
              [notifRes.rows[0].id, statusHtml]
            );
          }

          await editCurrentMessageSafe(statusHtml, replyMarkup);
          await answerSafe(
            wasNewlyTaken
              ? "[CONFIRMADO] Toma registrada. Quedan tomas pendientes en el bloque."
              : "[INFO] Toma ya registrada. Bloque sincronizado."
          );

          return {
            ok: true,
            action: "ack_log_partial",
            message: `[PARCIAL] Toma ${intakeLogId} confirmada (${clusterState.takenCount}/${clusterState.totalCount}).`,
            statusHtml,
          };
        }

        const hhmm = formatUtcHHMM();
        const statusHtml = `${this.formatClusterStateHtml(
          clusterState.label,
          clusterState.timeHHMM,
          clusterState.items,
          "CONFIRMADO"
        )}\n<code>[CONFIRMADO VIA TELEGRAM - ${hhmm}]</code>`;

        await query(
          `UPDATE notification_queue
           SET status = 'ACKNOWLEDGED',
               acknowledged_at = NOW(),
               acknowledged_by_chat_id = $3,
               message = $4
           WHERE source_type = 'MEDICATION_INTAKE'
             AND source_id = $1::uuid
             AND idempotency_key = $2`,
          [clusterId, idempotencyKey, fromId, statusHtml]
        );

        await editCurrentMessageSafe(statusHtml, { inline_keyboard: [] });
        await answerSafe("[CONFIRMADO] Bloque completo registrado como tomado.");

        return {
          ok: true,
          action: "ack_log_completed",
          message: `[CONFIRMADO] Bloque ${clusterId} completado (${clusterState.totalCount}/${clusterState.totalCount}).`,
          statusHtml,
        };
      }

      if (prefix === "restock_sel" && parts[1]) {
        const medId = parts[1];
        if (!UUID_REGEX.test(medId)) {
          await answerSafe("[ERROR] Identificador de medicamento invalido.");
          return {
            ok: true,
            action: "ignored",
            message: "Identificador de medicamento invalido.",
          };
        }

        const medRes = await query<{
          id: string;
          name: string;
          presentation: string;
          units_per_package: number | null;
          current_stock: number | null;
          days_of_supply_remaining: number | null;
        }>(
          `SELECT
             id, name, presentation,
             units_per_package::float8 AS units_per_package,
             current_stock::float8 AS current_stock,
             days_of_supply_remaining::float8 AS days_of_supply_remaining
           FROM medications
           WHERE id = $1::uuid
           LIMIT 1`,
          [medId]
        );

        const med = medRes.rows[0];
        if (!med) {
          await answerSafe("[ERROR] Medicamento no encontrado.");
          return {
            ok: true,
            action: "ignored",
            message: "Medicamento no encontrado.",
          };
        }

        const pkg = Math.max(1, Math.round(Number(med.units_per_package ?? 30) || 30));
        const stockText =
          med.current_stock === null ? "PENDIENTE DE CAPTURA" : `${med.current_stock} unidades`;
        const daysText =
          med.days_of_supply_remaining === null
            ? "PENDIENTE"
            : `${med.days_of_supply_remaining} dias`;

        const statusHtml = [
          `<b>[RESTOCK - ${escapeHtml(med.name)}]</b>`,
          "----------------------------------------",
          `Presentacion: ${escapeHtml(med.presentation)} (${med.units_per_package ? `${pkg} u/envase` : "envase pendiente, ref 30u"})`,
          `Inventario actual: ${stockText}`,
          `Cobertura estimada: ${daysText}`,
          "----------------------------------------",
          "Seleccione la cantidad a sumar al inventario:",
        ].join("\n");

        const replyMarkup = this.buildRestockInlineKeyboard(med.id, pkg);

        if (cq.message?.chat?.id !== undefined && cq.message?.message_id) {
          await editCurrentMessageSafe(statusHtml, replyMarkup);
        } else if (!isSimulatedCallback) {
          const fallbackChatId = cq.message?.chat?.id ?? fromId;
          await sendTelegramMessageSafe(
            botToken,
            fallbackChatId,
            statusHtml,
            replyMarkup
          );
        }

        await answerSafe(`[RESTOCK] Opciones para ${med.name}.`);
        return {
          ok: true,
          action: "restock_sel",
          message: `[RESTOCK] Opciones de reabastecimiento mostradas para ${med.name}.`,
          statusHtml,
        };
      }

      if (prefix === "restock_add" && parts[1] && parts[2]) {
        const medId = parts[1];
        const qty = Number(parts[2]);

        if (
          !UUID_REGEX.test(medId) ||
          !Number.isFinite(qty) ||
          qty <= 0 ||
          qty > 10000
        ) {
          await answerSafe("[ERROR] Parametros de restock invalidos.");
          return {
            ok: true,
            action: "ignored",
            message: "Parametros de restock invalidos.",
          };
        }

        const { DoseClusteringService } = await import(
          "./dose-clustering.service"
        );
        const updatedMed = await DoseClusteringService.restockMedication(
          medId,
          qty,
          `telegram:${fromId}`,
          { origin: "TELEGRAM" }
        );
        safeRevalidateHome();

        const hhmm = formatUtcHHMM();
        const statusHtml = [
          `<b>[RESTOCK CONFIRMADO +${qty}]</b>`,
          `Medicamento: ${escapeHtml(updatedMed.name)}`,
          `Nuevo inventario: ${updatedMed.current_stock} ${escapeHtml(updatedMed.presentation)}`,
          `Cobertura estimada: ${updatedMed.days_of_supply_remaining} dias`,
          `<code>[CONFIRMADO VIA TELEGRAM - ${hhmm}]</code>`,
        ].join("\n");

        await editCurrentMessageSafe(statusHtml, { inline_keyboard: [] });
        await answerSafe(
          `[CONFIRMADO] +${qty} unidades agregadas a ${updatedMed.name}.`
        );
        return {
          ok: true,
          action: "restock_add",
          message: `[RESTOCK CONFIRMADO] +${qty} ${updatedMed.presentation} sumados a ${updatedMed.name} (Stock actual: ${updatedMed.current_stock}).`,
          statusHtml,
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
    const chatId = update.message?.chat?.id;

    if (chatId !== undefined && msgText) {
      const normalizedCmd =
        msgText.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";

      if (normalizedCmd === "/start" || normalizedCmd === "/menu") {
        const statusHtml = [
          "<b>[TERMINAL CLINICA DEL PACIENTE]</b>",
          "----------------------------------------",
          "Control operativo de medicacion, inventario y citas medicas.",
          "Utilice el teclado inferior para operar sin escribir:",
          "- <b>[ Tomas de Hoy ]</b> (/tomas): Confirmar bloques o tomas individuales",
          "- <b>[ Registrar Restock ]</b> (/restock): Sumar envases o unidades al inventario",
          "- <b>[ Proximas Citas ]</b> (/citas): Consultar agenda de eventos clinicos",
          "- <b>[ Estado de Inventario ]</b> (/estado): Reporte clinico consolidado",
        ].join("\n");

        await sendTelegramMessageSafe(
          botToken,
          chatId,
          statusHtml,
          PATIENT_PERSISTENT_KEYBOARD
        );

        return {
          ok: true,
          action: "menu",
          message: "[MENU] Teclado persistente de paciente enviado.",
          statusHtml,
        };
      }

      if (msgText === "[ Tomas de Hoy ]" || normalizedCmd === "/tomas") {
        const todayStr = new Date().toISOString().slice(0, 10);

        const logsRes = await query<{
          intake_log_id: string;
          cluster_id: string;
          cluster_label: string;
          anchor_time: string;
          med_name: string;
          quantity_deducted: number;
          presentation: string;
          intake_rule: IntakeConstraint;
          status: IntakeStatus;
        }>(
          `SELECT
             il.id AS intake_log_id,
             il.cluster_id,
             ic.label AS cluster_label,
             ic.anchor_time::text AS anchor_time,
             m.name AS med_name,
             il.quantity_deducted::float8 AS quantity_deducted,
             m.presentation,
             m.intake_rule,
             il.status
           FROM intake_logs il
           JOIN intake_clusters ic ON ic.id = il.cluster_id
           JOIN medications m ON m.id = il.medication_id
           WHERE (il.scheduled_for AT TIME ZONE 'UTC')::date = $1::date
             AND il.cluster_id IS NOT NULL
           ORDER BY ic.anchor_time ASC, m.name ASC`,
          [todayStr]
        );

        const clusterMap = new Map<
          string,
          {
            clusterId: string;
            label: string;
            anchorTime: string;
            items: ClusterStateItem[];
            pendingItems: ClusterPendingItem[];
            takenCount: number;
          }
        >();

        for (const row of logsRes.rows) {
          const entry = clusterMap.get(row.cluster_id) ?? {
            clusterId: row.cluster_id,
            label: row.cluster_label,
            anchorTime: row.anchor_time,
            items: [],
            pendingItems: [],
            takenCount: 0,
          };
          entry.items.push({
            name: row.med_name,
            dose: `${row.quantity_deducted} ${row.presentation}`,
            ruleLabel: INTAKE_RULE_LABEL[row.intake_rule],
            status: row.status,
          });
          if (row.status === "PENDING") {
            entry.pendingItems.push({
              intake_log_id: row.intake_log_id,
              medication_name: row.med_name,
            });
          }
          if (row.status === "TAKEN") {
            entry.takenCount += 1;
          }
          clusterMap.set(row.cluster_id, entry);
        }

        const unclusteredRes = await query<{
          intake_log_id: string;
          med_name: string;
          quantity_deducted: number;
          presentation: string;
          intake_rule: IntakeConstraint;
          scheduled_time: string;
        }>(
          `SELECT
             il.id AS intake_log_id,
             m.name AS med_name,
             il.quantity_deducted::float8 AS quantity_deducted,
             m.presentation,
             m.intake_rule,
             COALESCE(ms.effective_clustered_time::text, (il.scheduled_for AT TIME ZONE 'UTC')::time::text) AS scheduled_time
           FROM intake_logs il
           JOIN medications m ON m.id = il.medication_id
           LEFT JOIN medication_schedules ms ON ms.id = il.schedule_id
           WHERE (il.scheduled_for AT TIME ZONE 'UTC')::date = $1::date
             AND il.cluster_id IS NULL
             AND il.status = 'PENDING'
             AND m.is_active = TRUE
           ORDER BY scheduled_time ASC, m.name ASC`,
          [todayStr]
        );

        const pendingClusters = Array.from(clusterMap.values()).filter(
          (c) => c.pendingItems.length > 0
        );

        if (pendingClusters.length === 0 && unclusteredRes.rows.length === 0) {
          const statusHtml =
            "<code>[OK] Todas las tomas de hoy han sido confirmadas.</code>";
          await sendTelegramMessageSafe(
            botToken,
            chatId,
            statusHtml,
            PATIENT_PERSISTENT_KEYBOARD
          );
          return {
            ok: true,
            action: "tomas_hoy",
            message: "[OK] Todas las tomas de hoy han sido confirmadas.",
            statusHtml,
          };
        }

        const blocksHtml: string[] = [];
        let simOffset = 0;

        if (unclusteredRes.rows.length > 0) {
          const dedicatedHtml = this.formatClusterStateHtml(
            "Tomas en Horario Dedicado",
            unclusteredRes.rows[0].scheduled_time.slice(0, 5),
            unclusteredRes.rows.map((r) => ({
              name: `${r.med_name} (${r.scheduled_time.slice(0, 5)})`,
              dose: `${r.quantity_deducted} ${r.presentation}`,
              ruleLabel: INTAKE_RULE_LABEL[r.intake_rule],
              status: "PENDING",
            })),
            "PENDIENTE DE CONFIRMACION"
          );
          const dedicatedMarkup: InlineKeyboardMarkup = {
            inline_keyboard: unclusteredRes.rows.map((r) => [
              {
                text: `[ Tomar: ${r.med_name.slice(0, 26)} (${r.scheduled_time.slice(0, 5)}) ]`,
                callback_data: truncateCallbackData(`ack_log:${r.intake_log_id}`),
              },
            ]),
          };
          await sendTelegramMessageSafe(
            botToken,
            chatId,
            dedicatedHtml,
            dedicatedMarkup,
            simOffset
          );
          simOffset += 1;
          blocksHtml.push(dedicatedHtml);
        }

        for (const cluster of pendingClusters) {
          const timeHHMM = cluster.anchorTime.slice(0, 5);
          const footerStatus =
            cluster.takenCount > 0
              ? `CONFIRMADO PARCIAL (${cluster.takenCount}/${cluster.items.length})`
              : "PENDIENTE DE CONFIRMACION";

          const blockHtml = this.formatClusterStateHtml(
            cluster.label,
            timeHHMM,
            cluster.items,
            footerStatus
          );

          const idempotencyKey = `CLUSTER_${cluster.clusterId}_${todayStr}`;
          const callbackPayload = truncateCallbackData(
            `ack_cluster:${cluster.clusterId}:${todayStr}`
          );
          const triggerAt = `${todayStr} ${cluster.anchorTime}+00`;

          const upsertRes = await query<{
            id: string;
            telegram_message_ids: unknown;
          }>(
            `INSERT INTO notification_queue (
               source_type, source_id, stage, trigger_at, status,
               title, message, callback_action_payload, idempotency_key
             ) VALUES (
               'MEDICATION_INTAKE', $1::uuid, 'EXACT_TIME', $2::timestamptz, 'SENT',
               $3, $4, $5, $6
             )
             ON CONFLICT (idempotency_key) DO UPDATE
             SET message = EXCLUDED.message,
                 status = CASE
                   WHEN notification_queue.status = 'ACKNOWLEDGED' THEN 'SENT'
                   ELSE notification_queue.status
                 END
             RETURNING id, telegram_message_ids`,
            [
              cluster.clusterId,
              triggerAt,
              `[BLOQUE DE MEDICACION - ${timeHHMM}] ${cluster.label}`,
              blockHtml,
              callbackPayload,
              idempotencyKey,
            ]
          );

          const notifRow = upsertRes.rows[0];
          const replyMarkup = this.buildClusterInlineKeyboard(
            notifRow.id,
            cluster.clusterId,
            todayStr,
            cluster.pendingItems
          );

          const sentRef = await sendTelegramMessageSafe(
            botToken,
            chatId,
            blockHtml,
            replyMarkup,
            simOffset
          );
          simOffset += 1;

          if (sentRef) {
            const mergedRefs = mergeDeliveredMessageRefs(
              parseDeliveredMessageRefs(notifRow.telegram_message_ids),
              [sentRef]
            );
            await query(
              `UPDATE notification_queue
               SET telegram_message_ids = $2::jsonb,
                   sent_at = COALESCE(sent_at, NOW())
               WHERE id = $1::uuid`,
              [notifRow.id, JSON.stringify(mergedRefs)]
            );
          }

          blocksHtml.push(blockHtml);
        }

        const statusHtml = blocksHtml.join("\n\n");
        return {
          ok: true,
          action: "tomas_hoy",
          message: `[TOMAS DE HOY] ${pendingClusters.length} bloque(s) pendientes enviados.`,
          statusHtml,
        };
      }

      if (msgText === "[ Registrar Restock ]" || normalizedCmd === "/restock") {
        const medsRes = await query<{
          id: string;
          name: string;
          presentation: string;
          current_stock: number | null;
          days_of_supply_remaining: number | null;
        }>(
          `SELECT
             id,
             name,
             presentation,
             current_stock::float8 AS current_stock,
             days_of_supply_remaining::float8 AS days_of_supply_remaining
           FROM medications
           WHERE is_active = TRUE
           ORDER BY days_of_supply_remaining ASC NULLS FIRST, name ASC`
        );

        if (medsRes.rows.length === 0) {
          const statusHtml =
            "<code>[SIN MEDICAMENTOS] No hay medicamentos activos registrados.</code>";
          await sendTelegramMessageSafe(
            botToken,
            chatId,
            statusHtml,
            PATIENT_PERSISTENT_KEYBOARD
          );
          return {
            ok: true,
            action: "restock_menu",
            message: "[RESTOCK] Sin medicamentos activos.",
            statusHtml,
          };
        }

        const lines = [
          "<b>[REGISTRAR RESTOCK DE INVENTARIO]</b>",
          "----------------------------------------",
          "Seleccione el medicamento que desea reabastecer:",
          ...medsRes.rows.map((m, idx) => {
            const tag =
              m.days_of_supply_remaining === null
                ? "[PENDIENTE]"
                : Number(m.days_of_supply_remaining) <= 7
                ? "[CRITICO]"
                : "[ESTABLE]";
            const stockDesc =
              m.current_stock === null
                ? "Stock: PENDIENTE"
                : `Stock: ${m.current_stock} ${escapeHtml(m.presentation)} (${m.days_of_supply_remaining} d)`;
            return `<code>${tag}</code> <b>${idx + 1}. ${escapeHtml(m.name)}</b> | ${stockDesc}`;
          }),
        ];
        const statusHtml = lines.join("\n");

        const inlineKeyboard: InlineKeyboardMarkup = {
          inline_keyboard: medsRes.rows.map((m) => [
            {
              text:
                m.current_stock === null
                  ? `[ ${m.name.slice(0, 24)} | PENDIENTE ]`
                  : `[ ${m.name.slice(0, 24)} | ${m.current_stock}u (${m.days_of_supply_remaining}d) ]`,
              callback_data: truncateCallbackData(`restock_sel:${m.id}`),
            },
          ]),
        };

        await sendTelegramMessageSafe(
          botToken,
          chatId,
          statusHtml,
          inlineKeyboard
        );

        return {
          ok: true,
          action: "restock_menu",
          message: `[RESTOCK] Menu interactivo enviado (${medsRes.rows.length} medicamentos).`,
          statusHtml,
        };
      }

      if (msgText === "[ Proximas Citas ]" || normalizedCmd === "/citas") {
        const eventsRes = await query<{
          id: string;
          title: string;
          category: EventCategory;
          specialist_or_center: string | null;
          location_address: string | null;
          event_datetime: string;
          preparation_instructions: string | null;
        }>(
          `SELECT
             id, title, category, specialist_or_center, location_address,
             event_datetime::text AS event_datetime,
             preparation_instructions
           FROM clinical_events
           WHERE is_completed = FALSE
           ORDER BY event_datetime ASC
           LIMIT 10`
        );

        const lines: string[] = [
          "<b>[PROXIMAS CITAS Y EVENTOS CLINICOS]</b>",
          "----------------------------------------",
        ];

        if (eventsRes.rows.length === 0) {
          lines.push(
            "<code>[SIN EVENTOS] No hay citas o eventos clinicos pendientes.</code>"
          );
        } else {
          for (const evt of eventsRes.rows) {
            const dt = evt.event_datetime.slice(0, 16).replace("T", " ");
            const tag = EVENT_CATEGORY_TAG[evt.category] ?? "[EVENTO]";
            lines.push(
              `<code>${escapeHtml(tag)}</code> <b>${escapeHtml(evt.title)}</b> | ${escapeHtml(dt)}`
            );
            if (evt.specialist_or_center) {
              lines.push(
                `  Especialista/Centro: ${escapeHtml(evt.specialist_or_center)}`
              );
            }
            if (evt.location_address) {
              lines.push(`  Ubicacion: ${escapeHtml(evt.location_address)}`);
            }
            if (evt.preparation_instructions) {
              lines.push(
                `  Indicaciones: ${escapeHtml(evt.preparation_instructions)}`
              );
            }
          }
        }

        const statusHtml = lines.join("\n");
        await sendTelegramMessageSafe(
          botToken,
          chatId,
          statusHtml,
          PATIENT_PERSISTENT_KEYBOARD
        );

        return {
          ok: true,
          action: "citas",
          message: `[CITAS] Listado de ${eventsRes.rows.length} evento(s) enviado.`,
          statusHtml,
        };
      }

      if (
        msgText === "[ Estado de Inventario ]" ||
        normalizedCmd === "/estado" ||
        msgText.startsWith("/estado")
      ) {
        const statusHtml = await this.generateEstadoHtml();
        await sendTelegramMessageSafe(
          botToken,
          chatId,
          statusHtml,
          PATIENT_PERSISTENT_KEYBOARD
        );
        return {
          ok: true,
          action: "estado",
          message: "[ESTADO] Reporte clinico generado.",
          statusHtml,
        };
      }
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

  static async updateRecipient(
    recipientId: string,
    input: { full_name: string; role: string; telegram_chat_id: string },
    actor = "Consola Clinica Web"
  ): Promise<TelegramRecipient> {
    const res = await query<TelegramRecipientRow>(
      `UPDATE telegram_recipients
       SET full_name = $2,
           role = $3,
           telegram_chat_id = $4
       WHERE id = $1::uuid
       RETURNING *`,
      [
        recipientId,
        input.full_name.trim(),
        input.role.trim(),
        input.telegram_chat_id.trim(),
      ]
    );
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Destinatario de Telegram no encontrado.");
    }
    await GovernanceAuditService.log({
      entity_type: "TELEGRAM_RECIPIENT",
      entity_id: updated.id,
      entity_label: updated.full_name,
      action: "UPDATE",
      actor,
      summary: `Destinatario "${updated.full_name}" (Chat ID ${updated.telegram_chat_id}) actualizado.`,
    });
    return updated;
  }

  static async deleteRecipient(
    recipientId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    const res = await query<{ id: string; full_name: string }>(
      `DELETE FROM telegram_recipients WHERE id = $1::uuid RETURNING id, full_name`,
      [recipientId]
    );
    const deleted = res.rows[0];
    if (!deleted) {
      throw new Error("Destinatario de Telegram no encontrado.");
    }
    await GovernanceAuditService.log({
      entity_type: "TELEGRAM_RECIPIENT",
      entity_id: deleted.id,
      entity_label: deleted.full_name,
      action: "DELETE",
      actor,
      summary: `Destinatario "${deleted.full_name}" eliminado de Telegram.`,
    });
    return { deletedId: deleted.id };
  }

  static async retryNotification(
    notifId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ id: string }> {
    const res = await query<{ id: string; title: string }>(
      `UPDATE notification_queue
       SET status = 'QUEUED',
           retry_count = 0,
           last_error = NULL,
           trigger_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, title`,
      [notifId]
    );
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Notificacion no encontrada.");
    }
    await GovernanceAuditService.log({
      entity_type: "NOTIFICATION",
      entity_id: updated.id,
      entity_label: updated.title,
      action: "RETRY",
      actor,
      summary: `Notificacion "${updated.title}" reencolada para envio inmediato.`,
    });
    return { id: updated.id };
  }

  static async cancelNotification(
    notifId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ id: string }> {
    const res = await query<{ id: string; title: string }>(
      `UPDATE notification_queue
       SET status = 'ACKNOWLEDGED',
           acknowledged_at = NOW(),
           acknowledged_by_chat_id = 'CANCELADO_WEB'
       WHERE id = $1::uuid
       RETURNING id, title`,
      [notifId]
    );
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Notificacion no encontrada.");
    }
    await GovernanceAuditService.log({
      entity_type: "NOTIFICATION",
      entity_id: updated.id,
      entity_label: updated.title,
      action: "CANCEL",
      actor,
      summary: `Notificacion "${updated.title}" marcada como atendida/cancelada.`,
    });
    return { id: updated.id };
  }

  static async deleteNotification(
    notifId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    const res = await query<{ id: string; title: string }>(
      `DELETE FROM notification_queue WHERE id = $1::uuid RETURNING id, title`,
      [notifId]
    );
    const deleted = res.rows[0];
    if (!deleted) {
      throw new Error("Notificacion no encontrada.");
    }
    await GovernanceAuditService.log({
      entity_type: "NOTIFICATION",
      entity_id: deleted.id,
      entity_label: deleted.title,
      action: "DELETE",
      actor,
      summary: `Notificacion "${deleted.title}" eliminada de la cola.`,
    });
    return { deletedId: deleted.id };
  }

  static async purgeAcknowledgedNotifications(
    actor = "Consola Clinica Web"
  ): Promise<{ purgedCount: number }> {
    const res = await query<{ id: string }>(
      `DELETE FROM notification_queue WHERE status = 'ACKNOWLEDGED' RETURNING id`
    );
    await GovernanceAuditService.log({
      entity_type: "NOTIFICATION",
      entity_id: "BATCH",
      entity_label: "Cola de Notificaciones",
      action: "DELETE",
      actor,
      summary: `Depuracion de cola: ${res.rowCount} notificaciones confirmadas eliminadas.`,
    });
    return { purgedCount: res.rowCount };
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
