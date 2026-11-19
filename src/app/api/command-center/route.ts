import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import { getCommandCenterSnapshot } from "@/lib/services/command-center.service";
import { NO_STORE_HEADERS } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date") ?? undefined;
    const snapshot = await getCommandCenterSnapshot(dateParam, session.role);
    return NextResponse.json(snapshot, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, message } = formatApiError(
      err,
      "Error al cargar Command Center."
    );
    return NextResponse.json(
      { error: message },
      { status: status === 400 ? 500 : status, headers: NO_STORE_HEADERS }
    );
  }
}
