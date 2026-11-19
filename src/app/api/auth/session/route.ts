import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { NO_STORE_HEADERS } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { headers: NO_STORE_HEADERS }
    );
  }
  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: session.uid,
        username: session.username,
        displayName: session.displayName,
        role: session.role,
      },
    },
    { headers: NO_STORE_HEADERS }
  );
}
