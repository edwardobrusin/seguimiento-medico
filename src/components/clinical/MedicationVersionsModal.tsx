"use client";

import { useState } from "react";
import { Check, History, RotateCcw } from "lucide-react";
import { VERSION_ACTION_LABEL } from "@/lib/clinical-labels";
import { formatActiveDaysLabel } from "@/lib/periodicity";
import type { Medication, MedicationVersionItem } from "@/lib/types/clinical";
import { formatCurrencyMxn, formatDateTimeEs } from "@/lib/utils";
import { ClinicalModal } from "./ClinicalModal";
import { StatusBadge } from "./StatusBadge";

interface MedicationVersionsModalProps {
  medication: Medication | null;
  versions: MedicationVersionItem[];
  onClose: () => void;
  onRestoreVersion: (medicationId: string, versionId: string) => Promise<void>;
  onMarkReviewed: (versionId: string) => Promise<void>;
}

export function MedicationVersionsModal({
  medication,
  versions,
  onClose,
  onRestoreVersion,
  onMarkReviewed,
}: MedicationVersionsModalProps) {
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!medication) return null;

  const medVersions = [...versions]
    .filter((v) => v.medication_id === medication.id)
    .sort((a, b) => b.version_number - a.version_number);

  return (
    <ClinicalModal
      open={Boolean(medication)}
      onClose={onClose}
      title={`Control de Versiones: ${medication.name}`}
      subtitle="Historial completo de cambios y restauracion a cualquier version anterior (solo administradores)."
      maxWidthClass="max-w-3xl"
    >
      {medVersions.length === 0 ? (
        <div className="p-6 text-center text-[14px] text-[#475569] border border-[#E2E8F0] rounded-[6px] bg-[#F8FAFC]">
          <History
            className="w-6 h-6 mx-auto text-[#0E7490] mb-2"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <p className="font-semibold text-[#0F172A]">
            Sin cambios registrados todavia
          </p>
          <p className="mt-1 text-[13px] text-[#64748B]">
            Al realizar cualquier modificacion, ajuste de inventario o restock
            en este medicamento, se guardara automaticamente la version base
            actual y cada nueva version para poder restaurarla.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {medVersions.map((ver, idx) => {
            const snap = ver.snapshot_json;
            const isPatientUnreviewed =
              ver.changed_by_role === "PATIENT" && !ver.reviewed_by_admin;
            const isLatest = idx === 0;

            return (
              <article
                key={ver.id}
                className="border border-[#E2E8F0] rounded-[6px] p-4 bg-white space-y-3"
              >
                <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[#F1F5F9] pb-2.5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[14px] font-bold text-[#0F172A] px-2 py-0.5 bg-[#F1F5F9] border border-[#CBD5E1] rounded-[4px]">
                        v{ver.version_number}
                      </span>
                      <span className="font-bold text-[15px] text-[#0F172A]">
                        {VERSION_ACTION_LABEL[ver.change_action] ??
                          ver.change_action}
                      </span>
                      <StatusBadge
                        label={
                          ver.changed_by_role === "PATIENT"
                            ? "[EDITADO POR PACIENTE]"
                            : ver.changed_by_role === "ADMIN"
                            ? "[ADMIN]"
                            : "[BASE]"
                        }
                        tone={
                          ver.changed_by_role === "PATIENT"
                            ? "warn"
                            : ver.changed_by_role === "ADMIN"
                            ? "info"
                            : "neutral"
                        }
                      />
                      {isPatientUnreviewed && (
                        <StatusBadge label="[PENDIENTE REVISION]" tone="crit" />
                      )}
                      {ver.changed_by_role === "PATIENT" &&
                        ver.reviewed_by_admin && (
                          <StatusBadge label="[REVISADO]" tone="ok" />
                        )}
                      {isLatest && (
                        <StatusBadge label="[VERSION ACTUAL]" tone="ok" />
                      )}
                    </div>
                    <p className="font-mono text-[12px] text-[#64748B] tabular-nums">
                      {formatDateTimeEs(ver.created_at)} | Actor:{" "}
                      {ver.changed_by_actor}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isPatientUnreviewed && (
                      <button
                        type="button"
                        disabled={busyId === ver.id}
                        onClick={async () => {
                          setBusyId(ver.id);
                          try {
                            await onMarkReviewed(ver.id);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="clinical-btn inline-flex items-center gap-1.5 px-3 border border-[#A7F3D0] bg-[#ECFDF5] hover:bg-[#D1FAE5] text-[#065F46] text-[13px] font-semibold"
                      >
                        <Check
                          className="w-4 h-4"
                          strokeWidth={1.85}
                          aria-hidden="true"
                        />
                        Marcar revisado
                      </button>
                    )}

                    {!isLatest &&
                      (confirmRestoreId === ver.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === ver.id}
                            onClick={async () => {
                              setBusyId(ver.id);
                              try {
                                await onRestoreVersion(medication.id, ver.id);
                                setConfirmRestoreId(null);
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            className="clinical-btn px-3 bg-[#0E7490] hover:bg-[#155E75] text-white text-[13px] font-bold"
                          >
                            {busyId === ver.id
                              ? "Restaurando..."
                              : "Confirmar restauracion"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRestoreId(null)}
                            className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white text-[13px]"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRestoreId(ver.id)}
                          className="clinical-btn inline-flex items-center gap-1.5 px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px] font-semibold"
                        >
                          <RotateCcw
                            className="w-4 h-4 text-[#0E7490]"
                            strokeWidth={1.85}
                            aria-hidden="true"
                          />
                          Restaurar v{ver.version_number}
                        </button>
                      ))}
                  </div>
                </header>

                <p className="text-[13px] text-[#334155]">{ver.change_summary}</p>

                {ver.changed_fields && ver.changed_fields.length > 0 && (
                  <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-[6px] p-3 space-y-1.5">
                    <div className="text-[12px] font-bold text-[#92400E]">
                      Campos modificados en esta version:
                    </div>
                    <ul className="space-y-1 text-[13px]">
                      {ver.changed_fields.map((d) => (
                        <li
                          key={d.field}
                          className="flex flex-wrap items-baseline gap-1.5"
                        >
                          <span className="font-semibold text-[#0F172A]">
                            {d.label}:
                          </span>
                          <span className="font-mono text-[#991B1B] line-through">
                            {d.before}
                          </span>
                          <span className="text-[#64748B]">-&gt;</span>
                          <span className="font-mono font-bold text-[#065F46]">
                            {d.after}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {snap && (
                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px] p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px] font-mono tabular-nums text-[#334155]">
                    <div>
                      <span className="block text-[#64748B]">Dosis</span>
                      <strong className="text-[#0F172A]">
                        {snap.dose_amount} {snap.presentation}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-[#64748B]">Dias</span>
                      <strong className="text-[#0F172A]">
                        {formatActiveDaysLabel(snap.active_days)}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-[#64748B]">Stock</span>
                      <strong className="text-[#0F172A]">
                        {snap.current_stock ?? "Pendiente"}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-[#64748B]">Precio envase</span>
                      <strong className="text-[#0F172A]">
                        {snap.package_price !== null
                          ? formatCurrencyMxn(snap.package_price)
                          : "Pendiente"}
                      </strong>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </ClinicalModal>
  );
}
