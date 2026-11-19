import { ZodError } from "zod";
import { AuthError } from "./auth/session";

export function formatApiError(
  err: unknown,
  fallback = "Error al procesar la solicitud."
): { status: number; message: string } {
  if (err instanceof AuthError) {
    return { status: err.status, message: err.message };
  }

  if (err instanceof ZodError) {
    const first = err.issues[0];
    const pathLabel = first?.path?.length ? `${first.path.join(".")}: ` : "";
    return {
      status: 400,
      message: first
        ? `Datos invalidos (${pathLabel}${first.message}). Verifica los campos e intenta de nuevo.`
        : "Datos invalidos en el formulario.",
    };
  }

  if (err instanceof Error) {
    return { status: 400, message: err.message || fallback };
  }

  return { status: 400, message: fallback };
}
