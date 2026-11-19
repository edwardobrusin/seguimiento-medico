import type { MedFrequencyType } from "./types/clinical";

/**
 * Orden clinico estándar de lunes a domingo (0 = Domingo, 1 = Lunes ... 6 = Sabado).
 */
export const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export const WEEKDAY_TWO_CHAR: Record<number, string> = {
  1: "Lu",
  2: "Ma",
  3: "Mi",
  4: "Ju",
  5: "Vi",
  6: "Sa",
  0: "Do",
};

export const WEEKDAY_ABBR: Record<number, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mie",
  4: "Jue",
  5: "Vie",
  6: "Sab",
  0: "Dom",
};

export const WEEKDAY_LABEL: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miercoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sabado",
  0: "Domingo",
};

export interface DaySchedulePreset {
  id: string;
  label: string;
  days: number[] | null;
}

export const DAY_SCHEDULE_PRESETS: readonly DaySchedulePreset[] = [
  { id: "ALL", label: "Todos los dias", days: null },
  { id: "MON_FRI", label: "Lunes a Viernes", days: [1, 2, 3, 4, 5] },
  { id: "MWF", label: "Lun / Mie / Vie", days: [1, 3, 5] },
  { id: "TTS", label: "Mar / Jue / Sab", days: [2, 4, 6] },
  { id: "WEEKEND", label: "Sab y Dom", days: [6, 0] },
];

export function normalizeActiveDays(
  raw: number[] | string | null | undefined
): number[] | null {
  if (raw === null || raw === undefined) return null;

  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;

  const set = new Set<number>();
  for (const item of arr) {
    const n = Number(item);
    if (Number.isInteger(n) && n >= 0 && n <= 6) {
      set.add(n);
    }
  }

  if (set.size === 0 || set.size === 7) {
    return null;
  }

  return WEEKDAY_ORDER.filter((d) => set.has(d));
}

export function activeDaysEqual(
  a: number[] | null | undefined,
  b: number[] | null | undefined
): boolean {
  const na = normalizeActiveDays(a);
  const nb = normalizeActiveDays(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  if (na.length !== nb.length) return false;
  return na.every((val, idx) => val === nb[idx]);
}

export function formatActiveDaysLabel(
  raw: number[] | string | null | undefined
): string {
  const norm = normalizeActiveDays(raw);
  if (!norm) return "Todos los dias";

  const key = norm.join(",");
  if (key === "1,2,3,4,5") return "Lunes a Viernes";
  if (key === "6,0") return "Sabado y Domingo";
  if (key === "1,3,5") return "Lun / Mie / Vie";
  if (key === "2,4,6") return "Mar / Jue / Sab";

  return norm.map((d) => WEEKDAY_ABBR[d] ?? String(d)).join(", ");
}

export function calculateEffectiveDailyRate(
  doseAmount: number,
  frequencyType: MedFrequencyType,
  frequencyValue: number,
  activeDays?: number[] | null
): number {
  if (!Number.isFinite(doseAmount) || doseAmount <= 0) return 0;
  const safeVal = Math.max(1, Number.isFinite(frequencyValue) ? frequencyValue : 1);
  const normalizedDays = normalizeActiveDays(activeDays);
  const activeCount = normalizedDays ? normalizedDays.length : 7;

  switch (frequencyType) {
    case "FIXED_HOURS":
      return Number(((((24 / safeVal) * doseAmount) * activeCount) / 7).toFixed(4));
    case "DAILY_SLOTS":
      return Number((((safeVal * doseAmount) * activeCount) / 7).toFixed(4));
    case "INTERVAL_DAYS":
      return Number((doseAmount / safeVal).toFixed(4));
    case "INTERVAL_WEEKS":
      return Number((doseAmount / (safeVal * 7)).toFixed(4));
  }
}

export function isDateActiveForMedication(
  med: {
    frequency_type: MedFrequencyType;
    frequency_value: number;
    active_days?: number[] | string | null;
    schedule_start_date?: string | null;
    created_date?: string | null;
    created_at?: string | null;
  },
  dateStr: string
): boolean {
  if (
    med.frequency_type === "DAILY_SLOTS" ||
    med.frequency_type === "FIXED_HOURS"
  ) {
    const norm = normalizeActiveDays(med.active_days);
    if (!norm) return true;
    const dow = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`).getUTCDay();
    return norm.includes(dow);
  }

  const intervalDays =
    med.frequency_type === "INTERVAL_WEEKS"
      ? Math.max(1, med.frequency_value) * 7
      : Math.max(1, med.frequency_value);

  const rawAnchor =
    med.schedule_start_date?.slice(0, 10) ||
    med.created_date?.slice(0, 10) ||
    (typeof med.created_at === "string" ? med.created_at.slice(0, 10) : null) ||
    dateStr.slice(0, 10);

  const anchorMs = new Date(`${rawAnchor}T00:00:00Z`).getTime();
  const targetMs = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(anchorMs) || Number.isNaN(targetMs)) return true;

  const diffDays = Math.floor((targetMs - anchorMs) / 86400000);
  if (diffDays < 0) return false;
  return diffDays % intervalDays === 0;
}
