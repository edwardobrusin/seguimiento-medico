import { NextResponse } from "next/server";
import { TelegramNotificationService } from "@/lib/services/telegram-notification.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

/**
 * Dispatches queued Telegram notifications when invoked with a valid CRON_SECRET bearer token.
 */
async function handleCronDispatch(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get("authorization") ?? "";

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const startMs = Date.now();
  try {
    const result =
      await TelegramNotificationService.dispatchQueuedNotifications();

    if (result.dispatched > 0) {
      safeRevalidateHome();
    }

    return NextResponse.json(
      {
        ok: true,
        dispatched_count: result.dispatched,
        failed_count: result.failed,
        execution_ms: Date.now() - startMs,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error en despachador cron.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function GET(req: Request) {
  return handleCronDispatch(req);
}

export async function POST(req: Request) {
  return handleCronDispatch(req);
}
