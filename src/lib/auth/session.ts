import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { UserRole } from "@/lib/types/clinical";

export const SESSION_COOKIE_NAME = "clinical_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 dias

export interface AuthSession {
  uid: string;
  username: string;
  displayName: string;
  role: UserRole;
  exp: number;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getSessionSecret(): string {
  return (
    process.env.AUTH_SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "clinical-local-session-secret-v1"
  );
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payloadB64)
    .digest("base64url");
}

export function createSessionToken(user: {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}): string {
  const payload: AuthSession = {
    uid: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signPayload(b64);
  return `${b64}.${sig}`;
}

export function verifySessionToken(
  token: string | null | undefined
): AuthSession | null {
  if (!token || typeof token !== "string") return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return null;

  const b64 = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!b64 || !sig) return null;

  const expectedSig = signPayload(b64);
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }
    const parsed = JSON.parse(
      Buffer.from(b64, "base64url").toString("utf8")
    ) as AuthSession;
    if (
      !parsed ||
      typeof parsed.uid !== "string" ||
      typeof parsed.username !== "string" ||
      (parsed.role !== "ADMIN" && parsed.role !== "PATIENT") ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}): Promise<void> {
  const token = createSessionToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
}

export async function getServerSession(): Promise<AuthSession | null> {
  try {
    const store = await cookies();
    const raw = store.get(SESSION_COOKIE_NAME)?.value;
    return verifySessionToken(raw);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getServerSession();
  if (!session) {
    throw new AuthError(401, "Sesion requerida. Inicia sesion para continuar.");
  }
  return session;
}

export async function requireAdmin(): Promise<AuthSession> {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new AuthError(
      403,
      "No cuentas con autorizacion para realizar esta operacion."
    );
  }
  return session;
}

export function getActorLabel(session: AuthSession): string {
  return `${session.displayName} (${
    session.role === "ADMIN" ? "Admin Web" : "Paciente Web"
  })`;
}
