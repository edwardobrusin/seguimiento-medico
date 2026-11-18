import { NextResponse } from "next/server";
import { getCommandCenterSnapshot } from "@/lib/services/command-center.service";
import { NO_STORE_HEADERS } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date") ?? undefined;
    const snapshot = await getCommandCenterSnapshot(dateParam);
    return NextResponse.json(snapshot, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error al cargar Command Center.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
