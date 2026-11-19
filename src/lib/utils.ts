import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatShortTime(timeStr: string | null | undefined): string {
  if (!timeStr) return "--:--";
  return timeStr.slice(0, 5);
}

export function formatDateTimeEs(isoStr: string | null | undefined): string {
  if (!isoStr) return "Sin fecha";
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDateOnlyEs(isoStr: string | null | undefined): string {
  if (!isoStr) return "Sin fecha";
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function toLocalDateTimeInput(isoStr: string | null | undefined): string {
  const date = isoStr ? new Date(isoStr) : new Date();
  if (Number.isNaN(date.getTime())) {
    return toLocalDateTimeInput(null);
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function getLocalDateIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface ClinicalDateParts {
  dateStr: string;
  hour: number;
  minute: number;
  totalMinutes: number;
  dayOfWeek: number; // 0 = Domingo ... 6 = Sabado
  isoWeekKey: string;
}

export function getClinicalDateParts(
  timeZone = "America/Mexico_City",
  now: Date = new Date()
): ClinicalDateParts {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map = new Map<string, string>();
  for (const part of dtf.formatToParts(now)) {
    map.set(part.type, part.value);
  }
  const year = map.get("year") ?? String(now.getUTCFullYear());
  const month = map.get("month") ?? String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = map.get("day") ?? String(now.getUTCDate()).padStart(2, "0");
  const rawHour = Number(map.get("hour") ?? now.getUTCHours());
  const hour = Number.isFinite(rawHour) ? rawHour % 24 : now.getUTCHours();
  const rawMin = Number(map.get("minute") ?? now.getUTCMinutes());
  const minute = Number.isFinite(rawMin) ? rawMin % 60 : now.getUTCMinutes();
  const dateStr = `${year}-${month}-${day}`;

  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  const dayOfWeek = noonUtc.getUTCDay();

  // ISO week calculation on UTC noon to stay DST-safe
  const isoDayNum = dayOfWeek === 0 ? 7 : dayOfWeek;
  const thursday = new Date(noonUtc.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 4 - isoDayNum);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1, 12, 0, 0));
  const weekNo = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const isoWeekKey = `${isoYear}-W${String(weekNo).padStart(2, "0")}`;

  return {
    dateStr,
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
    dayOfWeek,
    isoWeekKey,
  };
}

export function formatCurrencyMxn(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "--";
  }
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function getDaysUntil(isoStr: string): number {
  const target = new Date(isoStr).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}
