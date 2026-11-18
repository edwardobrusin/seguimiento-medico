import { NextResponse } from "next/server";
import { TelegramNotificationService } from "@/lib/services/telegram-notification.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function POST() {
  try {
    const result =
      await TelegramNotificationService.dispatchQueuedNotifications();
    if (result.dispatched > 0) {
      safeRevalidateHome();
    }
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error en despachador de Telegram.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
