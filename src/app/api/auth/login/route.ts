import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthService } from "@/lib/services/auth.service";
import { setSessionCookie } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import { NO_STORE_HEADERS } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const { username, password } = loginSchema.parse(raw);

    const user = await AuthService.authenticateUser(username, password);
    if (!user) {
      return NextResponse.json(
        { error: "Usuario o contrasena incorrectos." },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    await setSessionCookie(user);
    return NextResponse.json(
      { ok: true, user },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const { status, message } = formatApiError(err, "Error al iniciar sesion.");
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
