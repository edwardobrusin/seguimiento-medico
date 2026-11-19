import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";
import { NO_STORE_HEADERS } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
