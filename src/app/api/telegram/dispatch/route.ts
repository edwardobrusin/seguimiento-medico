import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import { TelegramNotificationService } from "@/lib/services/telegram-notification.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function POST() {
  try {
    await requireAdmin();
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
    const { status, message } = formatApiError(
      err,
      "Error en despachador de Telegram."
    );
    return NextResponse.json(
      { error: message },
      { status: status === 400 ? 500 : status, headers: NO_STORE_HEADERS }
    );
  }
}
