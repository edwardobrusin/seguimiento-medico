import { revalidatePath } from "next/cache";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

export function safeRevalidateHome(): void {
  try {
    revalidatePath("/");
  } catch {
    // Ejecucion fuera del request store de Next.js (por ejemplo, scripts CLI de verificacion)
  }
}
