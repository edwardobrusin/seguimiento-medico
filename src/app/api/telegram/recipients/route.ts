import { NextResponse } from "next/server";
import { z } from "zod";
import { TelegramNotificationService } from "@/lib/services/telegram-notification.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const recipientActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upsert"),
    full_name: z.string().min(1).max(120),
    role: z.string().min(1).max(60).default("CAREGIVER"),
    telegram_chat_id: z.string().min(1).max(64),
    receive_med_reminders: z.boolean().default(true),
    receive_restock_alerts: z.boolean().default(true),
    receive_event_reminders: z.boolean().default(true),
    receive_topic_reminders: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("toggle"),
    recipient_id: z.string().uuid(),
    field: z.enum([
      "receive_med_reminders",
      "receive_restock_alerts",
      "receive_event_reminders",
      "receive_topic_reminders",
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
]);

export async function POST(req: Request) {
  try {
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

    const status = await TelegramNotificationService.testBotConnection();
    return NextResponse.json(status, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Error al gestionar destinatarios de Telegram.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
