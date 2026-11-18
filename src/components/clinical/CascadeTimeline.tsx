"use client";

import type { AlertStage, CascadeStageSummary } from "@/lib/types/clinical";
import { ALERT_STAGE_SHORT, ALERT_STATUS_TAG } from "@/lib/clinical-labels";
import { formatDateTimeEs, cn } from "@/lib/utils";

const ORDERED_STAGES: AlertStage[] = [
  "7_DAYS_BEFORE",
  "3_DAYS_BEFORE",
  "1_DAY_BEFORE",
  "DAY_OF",
];

interface CascadeTimelineProps {
  alerts: CascadeStageSummary[];
}

export function CascadeTimeline({ alerts }: CascadeTimelineProps) {
  const byStage = new Map<AlertStage, CascadeStageSummary>();
  for (const alert of alerts) {
    byStage.set(alert.stage, alert);
  }

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      aria-label="Linea de recordatorios en cascada"
    >
      {ORDERED_STAGES.map((stage) => {
        const entry = byStage.get(stage);
        const status = entry?.status;
        const toneClass =
          status === "ACKNOWLEDGED"
            ? "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]"
            : status === "SENT"
            ? "bg-[#ECFEFF] border-[#A5F3FC] text-[#164E63]"
            : status === "QUEUED" || status === "SNOOZED"
            ? "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]"
            : "bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B]";

        return (
          <div
            key={stage}
            className={cn(
              "border rounded-[4px] px-2.5 py-2 flex flex-col gap-0.5",
              toneClass
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="font-mono text-[13px] font-semibold tabular-nums">
                {ALERT_STAGE_SHORT[stage]}
              </span>
              <span className="font-mono text-[13px]">
                {status ? ALERT_STATUS_TAG[status] : "[NO APLICA]"}
              </span>
            </div>
            <span className="font-mono text-[13px] opacity-85 tabular-nums truncate">
              {entry ? formatDateTimeEs(entry.trigger_at) : "Ventana vencida"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
