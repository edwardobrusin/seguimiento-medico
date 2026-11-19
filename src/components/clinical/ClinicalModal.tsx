"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClinicalModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: ReactNode;
}

export function ClinicalModal({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = "max-w-3xl",
  children,
}: ClinicalModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#0F172A]/45 backdrop-blur-[2px] clinical-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "clinical-modal-panel w-full bg-white border border-[#CBD5E1] rounded-[6px] shadow-xl flex flex-col max-h-[90dvh] outline-none",
          maxWidthClass
        )}
      >
        <header className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-start justify-between gap-4 shrink-0 rounded-t-[6px]">
          <div className="min-w-0">
            <h3
              id={titleId}
              className="text-[17px] font-bold text-[#0F172A] leading-snug"
            >
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-[13px] text-[#475569]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="clinical-icon-btn w-[44px] h-[44px] border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#334155] shrink-0"
          >
            <X className="w-5 h-5" strokeWidth={1.85} aria-hidden="true" />
          </button>
        </header>

        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
