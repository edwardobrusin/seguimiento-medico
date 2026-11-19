import { NextResponse } from "next/server";
import { z } from "zod";
import { getActorLabel, requireAdmin } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import { TelegramNotificationService } from "@/lib/services/telegram-notification.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const recipientActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upsert"),
    full_name: z.string().min(1).max(120),
    role: z.string().min(1).max(60).default("ADMIN"),
    telegram_chat_id: z.string().min(1).max(64),
    receive_med_reminders: z.boolean().optional(),
    receive_restock_alerts: z.boolean().optional(),
    receive_event_reminders: z.boolean().optional(),
    receive_topic_reminders: z.boolean().optional(),
    receive_missed_block_alerts: z.boolean().optional(),
    receive_weekly_report: z.boolean().optional(),
    receive_change_alerts: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("update"),
    recipient_id: z.string().uuid(),
    full_name: z.string().min(1).max(120),
    role: z.string().min(1).max(60),
    telegram_chat_id: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("delete"),
    recipient_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("toggle"),
    recipient_id: z.string().uuid(),
    field: z.enum([
      "receive_med_reminders",
      "receive_restock_alerts",
      "receive_event_reminders",
      "receive_topic_reminders",
      "receive_missed_block_alerts",
      "receive_weekly_report",
      "receive_change_alerts",
      "is_active",
    ]),
    value: z.boolean(),
  }),
  z.object({
    action: z.literal("test_connection"),
  }),
  z.object({
    action: z.literal("register_webhook"),
    base_url: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("retry_notification"),
    notification_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("cancel_notification"),
    notification_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("delete_notification"),
    notification_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("purge_acknowledged"),
  }),
  z.object({
    action: z.literal("update_monitoring_settings"),
    timezone: z.string().min(1).max(64).default("America/Mexico_City"),
    missed_block_grace_mins: z.number().int().min(10).max(360),
    missed_block_alerts_enabled: z.boolean(),
    weekly_report_enabled: z.boolean(),
    weekly_report_day: z.number().int().min(0).max(6),
    weekly_report_hour: z.number().int().min(0).max(23),
    notify_admin_on_patient_change: z.boolean(),
  }),
  z.object({
    action: z.literal("send_weekly_report_now"),
  }),
  z.object({
    action: z.literal("check_missed_blocks_now"),
  }),
]);

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const actor = getActorLabel(session);
    const raw = await req.json();
    const body = recipientActionSchema.parse(raw);

    if (body.action === "upsert") {
      const recipient = await TelegramNotificationService.upsertRecipient(body);
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, recipient },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "update") {
      const recipient = await TelegramNotificationService.updateRecipient(
        body.recipient_id,
        {
          full_name: body.full_name,
          role: body.role,
          telegram_chat_id: body.telegram_chat_id,
        },
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, recipient },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "delete") {
      const result = await TelegramNotificationService.deleteRecipient(
        body.recipient_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "toggle") {
      const recipient = await TelegramNotificationService.toggleRecipientField(
        body.recipient_id,
        body.field,
        body.value
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, recipient },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "register_webhook") {
      const result = await TelegramNotificationService.registerVercelWebhook(
        body.base_url
      );
      return NextResponse.json(result, { headers: NO_STORE_HEADERS });
    }

    if (body.action === "retry_notification") {
      const result = await TelegramNotificationService.retryNotification(
        body.notification_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "cancel_notification") {
      const result = await TelegramNotificationService.cancelNotification(
        body.notification_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "delete_notification") {
      const result = await TelegramNotificationService.deleteNotification(
        body.notification_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "purge_acknowledged") {
      const result =
        await TelegramNotificationService.purgeAcknowledgedNotifications(actor);
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "update_monitoring_settings") {
      const settings =
        await TelegramNotificationService.updateMonitoringSettings(body, actor);
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, settings },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "send_weekly_report_now") {
      const result =
        await TelegramNotificationService.queueWeeklyReportNow(actor);
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "check_missed_blocks_now") {
      const evalRes =
        await TelegramNotificationService.evaluateMissedBlockAlerts();
      const dispatchRes =
        await TelegramNotificationService.dispatchQueuedNotifications();
      safeRevalidateHome();
      return NextResponse.json(
        {
          ok: true,
          queued: evalRes.queued,
          dispatched: dispatchRes.dispatched,
          mode: dispatchRes.mode,
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const status = await TelegramNotificationService.testBotConnection();
    return NextResponse.json(status, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, message } = formatApiError(
      err,
      "Error al gestionar destinatarios y cola de Telegram."
    );
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
