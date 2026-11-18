"use client";

import { useState, type FormEvent } from "react";
import { PackagePlus, Plus, RefreshCw } from "lucide-react";
import type {
  CommandCenterSnapshot,
  IntakeConstraint,
  MedFrequencyType,
  Medication,
} from "@/lib/types/clinical";
import {
  FREQUENCY_TYPE_LABEL,
  INTAKE_RULE_LABEL,
  INTAKE_RULE_TAG,
} from "@/lib/clinical-labels";
import { cn, formatShortTime } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

interface MedicationsInventoryViewProps {
  snapshot: CommandCenterSnapshot;
  onCreateMedication: (payload: {
    name: string;
    active_ingredient: string;
    presentation: string;
    units_per_package: number;
    dose_amount: number;
    current_stock: number;
    frequency_type: MedFrequencyType;
    frequency_value: number;
    tolerance_window_mins: number;
    intake_rule: IntakeConstraint;
    clinical_notes: string;
    ideal_times: string[];
  }) => Promise<void>;
  onRestockMedication: (medicationId: string, quantity: number) => Promise<void>;
  onGenerateTodayLogs: () => Promise<void>;
}

function previewDailyRate(
  doseAmount: number,
  freqType: MedFrequencyType,
  freqValue: number
): number {
  if (!Number.isFinite(doseAmount) || !Number.isFinite(freqValue) || freqValue <= 0) {
    return 0;
  }
  switch (freqType) {
    case "FIXED_HOURS":
      return Number(((24 / freqValue) * doseAmount).toFixed(4));
    case "DAILY_SLOTS":
      return Number((freqValue * doseAmount).toFixed(4));
    case "INTERVAL_DAYS":
      return Number((doseAmount / freqValue).toFixed(4));
    case "INTERVAL_WEEKS":
      return Number((doseAmount / (freqValue * 7)).toFixed(4));
  }
}

export function MedicationsInventoryView({
  snapshot,
  onCreateMedication,
  onRestockMedication,
  onGenerateTodayLogs,
}: MedicationsInventoryViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [activeIngredient, setActiveIngredient] = useState("");
  const [presentation, setPresentation] = useState("Tableta");
  const [unitsPerPackage, setUnitsPerPackage] = useState("30");
  const [doseAmount, setDoseAmount] = useState("1");
  const [currentStock, setCurrentStock] = useState("30");
  const [frequencyType, setFrequencyType] =
    useState<MedFrequencyType>("FIXED_HOURS");
  const [frequencyValue, setFrequencyValue] = useState("8");
  const [toleranceMins, setToleranceMins] = useState("30");
  const [intakeRule, setIntakeRule] = useState<IntakeConstraint>("NONE");
  const [idealTimeInput, setIdealTimeInput] = useState("08:00");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [restockId, setRestockId] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState("30");

  const computedRate = previewDailyRate(
    Number(doseAmount),
    frequencyType,
    Number(frequencyValue)
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError("Escribe el nombre del medicamento.");
      return;
    }
    const doseNum = Number(doseAmount);
    const pkgNum = Number(unitsPerPackage);
    const stockNum = Number(currentStock);
    const freqNum = Number(frequencyValue);
    const tolNum = Number(toleranceMins);
    if (
      !Number.isFinite(doseNum) ||
      doseNum <= 0 ||
      !Number.isFinite(stockNum) ||
      stockNum < 0 ||
      !Number.isFinite(freqNum) ||
      freqNum <= 0
    ) {
      setFormError("Verifica que dosis, stock y periodicidad sean valores numericos validos.");
      return;
    }

    const idealTimes = idealTimeInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setIsSubmitting(true);
    try {
      await onCreateMedication({
        name: name.trim(),
        active_ingredient: activeIngredient.trim(),
        presentation: presentation.trim() || "Tableta",
        units_per_package: Number.isFinite(pkgNum) && pkgNum > 0 ? pkgNum : 30,
        dose_amount: doseNum,
        current_stock: stockNum,
        frequency_type: frequencyType,
        frequency_value: Math.round(freqNum),
        tolerance_window_mins: Number.isFinite(tolNum) ? Math.round(tolNum) : 30,
        intake_rule: intakeRule,
        clinical_notes: clinicalNotes.trim(),
        ideal_times: idealTimes.length > 0 ? idealTimes : ["08:00"],
      });
      setName("");
      setActiveIngredient("");
      setClinicalNotes("");
      setShowForm(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Error al registrar medicamento."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleQuickRestock(med: Medication) {
    const qty = Number(restockQty);
    if (!Number.isFinite(qty) || qty <= 0) return;
    await onRestockMedication(med.id, qty);
    setRestockId(null);
  }

  return (
    <div className="space-y-6 clinical-enter">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-[#0F172A]">
            Inventario Farmacologico y Motor de Agrupacion
          </h2>
          <p className="text-[14px] text-[#475569]">
            Calculo automatico de tasa diaria, dias de cobertura y alineacion en
            bloques horarios optimizados.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onGenerateTodayLogs()}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            <RefreshCw
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Regenerar Tomas de Hoy
          </button>

          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            {showForm ? "Cerrar Formulario" : "Registrar Medicamento"}
          </button>
        </div>
      </div>

      {/* Formulario de Registro + Calculo de Tasa Diaria */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="clinical-card p-5 space-y-4 border-[#A5F3FC] bg-white"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
            <h3 className="text-[16px] font-bold text-[#0F172A]">
              Nuevo Farmaco y Optimizacion de Bloques
            </h3>
            <span className="font-mono text-[13px] px-2.5 py-1 bg-[#ECFEFF] border border-[#A5F3FC] text-[#164E63] rounded-[4px] tabular-nums">
              Tasa diaria estimada: {computedRate} unid/dia
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="med-name"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Nombre del medicamento
              </label>
              <input
                id="med-name"
                type="text"
                required
                placeholder="Ej. Omeprazol 20mg"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
              />
            </div>

            <div>
              <label
                htmlFor="med-ingredient"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Principio activo
              </label>
              <input
                id="med-ingredient"
                type="text"
                placeholder="Ej. Omeprazol"
                value={activeIngredient}
                onChange={(e) => setActiveIngredient(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
              />
            </div>

            <div>
              <label
                htmlFor="med-presentation"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Presentacion
              </label>
              <select
                id="med-presentation"
                value={presentation}
                onChange={(e) => setPresentation(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px] bg-white"
              >
                <option value="Tableta">Tableta</option>
                <option value="Capsula">Capsula</option>
                <option value="Jeringa Prellenada">Jeringa Prellenada</option>
                <option value="Ampolleta">Ampolleta</option>
                <option value="ml">ml</option>
                <option value="Gotas">Gotas</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="med-pkg-units"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Unidades por envase / caja
              </label>
              <input
                id="med-pkg-units"
                type="number"
                step="1"
                min="1"
                required
                value={unitsPerPackage}
                onChange={(e) => setUnitsPerPackage(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[16px] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="med-dose"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Cantidad por toma
              </label>
              <input
                id="med-dose"
                type="number"
                step="0.5"
                min="0.1"
                required
                value={doseAmount}
                onChange={(e) => setDoseAmount(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[16px] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="med-stock"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Stock inicial actual
              </label>
              <input
                id="med-stock"
                type="number"
                step="0.5"
                min="0"
                required
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[16px] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="med-rule"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Regla de ingesta
              </label>
              <select
                id="med-rule"
                value={intakeRule}
                onChange={(e) =>
                  setIntakeRule(e.target.value as IntakeConstraint)
                }
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px] bg-white"
              >
                <option value="NONE">Sin Restriccion</option>
                <option value="FASTING">En Ayunas</option>
                <option value="WITH_FOOD">Con Alimentos</option>
                <option value="SEPARATE_FROM_OTHERS">Separado de Otros</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="med-freq-type"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Tipo de periodicidad
              </label>
              <select
                id="med-freq-type"
                value={frequencyType}
                onChange={(e) =>
                  setFrequencyType(e.target.value as MedFrequencyType)
                }
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px] bg-white"
              >
                <option value="FIXED_HOURS">Cada N horas (ej. 8h, 12h)</option>
                <option value="DAILY_SLOTS">Tomas por dia (ej. 1, 2)</option>
                <option value="INTERVAL_DAYS">Cada N dias</option>
                <option value="INTERVAL_WEEKS">Cada N semanas</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="med-freq-val"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Valor de frecuencia
              </label>
              <input
                id="med-freq-val"
                type="number"
                min="1"
                required
                value={frequencyValue}
                onChange={(e) => setFrequencyValue(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[16px] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="med-tolerance"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Ventana de tolerancia (mins)
              </label>
              <input
                id="med-tolerance"
                type="number"
                min="0"
                max="120"
                value={toleranceMins}
                onChange={(e) => setToleranceMins(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[16px] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="med-ideal-times"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Hora ideal inicial (HH:MM)
              </label>
              <input
                id="med-ideal-times"
                type="text"
                placeholder="07:30 o 08:00, 20:00"
                value={idealTimeInput}
                onChange={(e) => setIdealTimeInput(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[16px] tabular-nums"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="med-notes"
                className="block text-[14px] font-medium text-[#0F172A] mb-1"
              >
                Notas clinicas de administracion
              </label>
              <input
                id="med-notes"
                type="text"
                placeholder="Indicaciones medicas o contraindicaciones"
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
                className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[16px]"
              />
            </div>
          </div>

          {formError && (
            <p className="text-[14px] font-medium text-[#991B1B]" role="alert">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px] font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[15px] font-bold"
            >
              {isSubmitting
                ? "Calculando bloques..."
                : "Guardar y Optimizar Bloques"}
            </button>
          </div>
        </form>
      )}

      {/* Tabla de Inventario y Bloques Asignados */}
      <div className="clinical-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[13px] font-semibold text-[#475569]">
                <th className="py-3 px-4">Farmaco / Principio</th>
                <th className="py-3 px-3">Dosis / Periodicidad</th>
                <th className="py-3 px-3">Regla y Bloques Optimizados</th>
                <th className="py-3 px-3">Tasa Diaria</th>
                <th className="py-3 px-3">Stock Actual</th>
                <th className="py-3 px-3">Cobertura Estimada</th>
                <th className="py-3 px-4 text-right">Restock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {snapshot.medications.map((med) => {
                const days = Number(med.days_of_supply_remaining);
                const level =
                  days <= 7 ? "crit" : days <= 14 ? "warn" : "ok";
                const progressPct = Math.min(100, Math.max(4, (days / 30) * 100));

                return (
                  <tr key={med.id} className="bg-white hover:bg-[#F8FAFC]">
                    <td className="py-3.5 px-4 align-top">
                      <div className="font-bold text-[15px] text-[#0F172A]">
                        {med.name}
                      </div>
                      {med.active_ingredient && (
                        <div className="text-[13px] text-[#475569]">
                          {med.active_ingredient}
                        </div>
                      )}
                      {med.clinical_notes && (
                        <p className="mt-1 text-[13px] text-[#64748B] max-w-[34ch]">
                          {med.clinical_notes}
                        </p>
                      )}
                    </td>

                    <td className="py-3.5 px-3 align-top">
                      <div className="font-mono text-[14px] font-semibold tabular-nums text-[#0F172A]">
                        {med.dose_amount} {med.presentation}
                      </div>
                      <div className="text-[13px] text-[#475569] mt-0.5">
                        {FREQUENCY_TYPE_LABEL[med.frequency_type]}:{" "}
                        <span className="font-mono tabular-nums">
                          {med.frequency_value}
                        </span>
                      </div>
                      <div className="font-mono text-[13px] text-[#64748B] tabular-nums">
                        Tolerancia: +/-{med.tolerance_window_mins} min
                      </div>
                    </td>

                    <td className="py-3.5 px-3 align-top">
                      <div className="mb-1.5">
                        <StatusBadge
                          label={INTAKE_RULE_TAG[med.intake_rule]}
                          tone="info"
                        />
                        <span className="sr-only">
                          {INTAKE_RULE_LABEL[med.intake_rule]}
                        </span>
                      </div>
                      {med.schedules && med.schedules.length > 0 ? (
                        <ul className="space-y-1">
                          {med.schedules.map((sch) => (
                            <li
                              key={sch.schedule_id}
                              className="font-mono text-[13px] text-[#334155] tabular-nums"
                            >
                              {formatShortTime(sch.ideal_time)} -&gt;{" "}
                              <strong className="text-[#0E7490]">
                                {formatShortTime(sch.effective_clustered_time)}
                              </strong>{" "}
                              {sch.cluster_label
                                ? `(${sch.cluster_label})`
                                : "(Horario Dedicado)"}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[13px] text-[#64748B]">
                          Vinculado a evento clinico
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-3 align-top font-mono text-[14px] tabular-nums text-[#0F172A]">
                      {med.daily_consumption_rate}/dia
                    </td>

                    <td className="py-3.5 px-3 align-top font-mono text-[15px] font-bold tabular-nums text-[#0F172A]">
                      <div>
                        {med.current_stock} {med.presentation}
                      </div>
                      <div className="text-[13px] font-normal text-[#64748B]">
                        Envase: {med.units_per_package ?? 30} u.
                      </div>
                    </td>

                    <td className="py-3.5 px-3 align-top min-w-[170px]">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span
                          className={cn(
                            "font-mono text-[15px] font-bold tabular-nums",
                            level === "crit"
                              ? "text-[#991B1B]"
                              : level === "warn"
                              ? "text-[#92400E]"
                              : "text-[#065F46]"
                          )}
                        >
                          {days >= 999 ? "Indef." : `${days} dias`}
                        </span>
                        <StatusBadge
                          label={
                            level === "crit"
                              ? "[CRITICO]"
                              : level === "warn"
                              ? "[ATENCION]"
                              : "[OPTIMO]"
                          }
                          tone={level}
                        />
                      </div>
                      <div className="h-2 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full",
                            level === "crit"
                              ? "bg-[#DC2626]"
                              : level === "warn"
                              ? "bg-[#D97706]"
                              : "bg-[#059669]"
                          )}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </td>

                    <td className="py-3.5 px-4 align-top text-right">
                      {restockId === med.id ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <label
                            htmlFor={`inv-restock-${med.id}`}
                            className="sr-only"
                          >
                            Cantidad a agregar para {med.name}
                          </label>
                          <input
                            id={`inv-restock-${med.id}`}
                            type="number"
                            min="1"
                            step="1"
                            value={restockQty}
                            onChange={(e) => setRestockQty(e.target.value)}
                            className="w-24 h-[44px] px-2.5 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px] tabular-nums"
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleQuickRestock(med)}
                              className="clinical-btn px-3 bg-[#0E7490] text-white text-[13px] font-medium"
                            >
                              Sumar
                            </button>
                            <button
                              type="button"
                              onClick={() => setRestockId(null)}
                              className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white text-[#334155] text-[13px]"
                            >
                              X
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRestockId(med.id);
                            setRestockQty(String(med.units_per_package ?? 30));
                          }}
                          className="clinical-btn inline-flex items-center gap-1.5 px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[13px] font-medium"
                        >
                          <PackagePlus
                            className="w-4 h-4 text-[#0E7490]"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          Sumar Stock
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
