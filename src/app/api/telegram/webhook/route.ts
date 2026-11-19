import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import {
  TelegramNotificationService,
  type TelegramUpdatePayload,
} from "@/lib/services/telegram-notification.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const isLocalSimulation = url.searchParams.get("simulate") === "1";
    if (isLocalSimulation) {
      await requireAdmin();
    }

    const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
    const update = (await req.json()) as TelegramUpdatePayload;

    const result = await TelegramNotificationService.handleWebhookUpdate(
      update,
      secretHeader,
      { skipSecretCheck: isLocalSimulation }
    );

    if (result.unauthorized) {
      return NextResponse.json(
        { error: result.message ?? "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    if (result.action && result.action !== "noop") {
      safeRevalidateHome();
    }

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, message } = formatApiError(
      err,
      "Error en webhook de Telegram."
    );
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
