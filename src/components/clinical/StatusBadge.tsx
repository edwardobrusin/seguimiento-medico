"use client";

import { cn } from "@/lib/utils";

export type BadgeTone = "ok" | "warn" | "crit" | "info" | "neutral";

interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
  className?: string;
}

const TONE_STYLES: Record<BadgeTone, string> = {
  ok: "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]",
  warn: "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]",
  crit: "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]",
  info: "bg-[#ECFEFF] border-[#A5F3FC] text-[#164E63]",
  neutral: "bg-[#F1F5F9] border-[#CBD5E1] text-[#334155]",
};

export function StatusBadge({
  label,
  tone = "neutral",
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 border rounded-[4px] font-mono text-[13px] font-medium leading-tight tracking-tight whitespace-nowrap",
        TONE_STYLES[tone],
        className
      )}
    >
      {label}
    </span>
  );
}
