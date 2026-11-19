import { NextResponse } from "next/server";
import { z } from "zod";
import { getActorLabel, requireAdmin } from "@/lib/auth/session";
import { AuthService } from "@/lib/services/auth.service";
import { formatApiError } from "@/lib/api-error";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const usersActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("update_user"),
    user_id: z.string().uuid(),
    username: z.string().min(3).max(64).optional(),
    display_name: z.string().min(1).max(120).optional(),
    new_password: z.string().min(6).max(200).optional(),
  }),
]);

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const raw = await req.json();
    const body = usersActionSchema.parse(raw);

    if (body.action === "list") {
      const users = await AuthService.listAuthUsers();
      return NextResponse.json(
        { ok: true, users },
        { headers: NO_STORE_HEADERS }
      );
    }

    const user = await AuthService.updateAuthUser(
      body.user_id,
      {
        username: body.username,
        display_name: body.display_name,
        new_password: body.new_password,
      },
      getActorLabel(session)
    );
    safeRevalidateHome();
    return NextResponse.json({ ok: true, user }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, message } = formatApiError(
      err,
      "Error al gestionar cuentas de acceso."
    );
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
