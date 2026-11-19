"use client";

import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type IconActionTone =
  | "primary"
  | "success"
  | "warn"
  | "neutral"
  | "danger"
  | "info";

interface IconActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  tone?: IconActionTone;
  disabled?: boolean;
  loading?: boolean;
  active?: boolean;
  badgeDot?: boolean;
  shortLabel?: string;
  type?: "button" | "submit";
  className?: string;
}

const TONE_CLASSES: Record<IconActionTone, string> = {
  primary:
    "bg-[#0E7490] border-[#0E7490] text-white hover:bg-[#155E75] hover:border-[#155E75]",
  success:
    "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46] hover:bg-[#D1FAE5] hover:border-[#6EE7B7]",
  warn: "bg-[#FFFBEB] border-[#F59E0B] text-[#92400E] hover:bg-[#FEF3C7]",
  info: "bg-[#ECFEFF] border-[#A5F3FC] text-[#164E63] hover:bg-[#CFFAFE]",
  neutral:
    "bg-white border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9] hover:text-[#0F172A]",
  danger:
    "bg-white border-[#FECACA] text-[#991B1B] hover:bg-[#FEF2F2] hover:border-[#F87171]",
};

export function IconActionButton({
  icon: Icon,
  label,
  onClick,
  tone = "neutral",
  disabled = false,
  loading = false,
  active = false,
  badgeDot = false,
  shortLabel,
  type = "button",
  className,
}: IconActionButtonProps) {
  return (
    <span className="clinical-tooltip-wrap">
      <button
        type={type}
        onClick={onClick}
        disabled={disabled || loading}
        aria-label={label}
        aria-pressed={active || undefined}
        className={cn(
          "clinical-icon-btn border font-medium select-none",
          shortLabel ? "px-3 gap-1.5" : "w-[44px]",
          TONE_CLASSES[tone],
          active && "ring-2 ring-[#0891B2] ring-offset-1",
          className
        )}
      >
        {loading ? (
          <Loader2
            className="w-[18px] h-[18px] animate-spin"
            strokeWidth={2}
            aria-hidden="true"
          />
        ) : (
          <Icon
            className="w-[18px] h-[18px] shrink-0"
            strokeWidth={1.85}
            aria-hidden="true"
          />
        )}
        {shortLabel && (
          <span className="text-[13px] font-semibold whitespace-nowrap">
            {shortLabel}
          </span>
        )}
        {badgeDot && (
          <span
            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#D97706] border-2 border-white"
            aria-hidden="true"
          />
        )}
      </button>
      <span role="tooltip" className="clinical-tooltip">
        {label}
      </span>
    </span>
  );
}
