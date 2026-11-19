"use client";

import { useState, type FormEvent } from "react";
import {
  Activity,
  AlertOctagon,
  Copy,
  Edit3,
  FileText,
  History,
  Phone,
  Plus,
  Printer,
  ShieldAlert,
  Stethoscope,
  Trash2,
} from "lucide-react";
import type {
  CareProvider,
  CommandCenterSnapshot,
} from "@/lib/types/clinical";
import { AUDIT_ACTION_TAG } from "@/lib/clinical-labels";
import { cn, formatCurrencyMxn, formatDateTimeEs, formatShortTime } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

interface PatientDossierViewProps {
  snapshot: CommandCenterSnapshot;
  onUpdateProfile: (payload: {
    full_name: string;
    birth_date: string | null;
    blood_type: string | null;
    weight_kg: number | null;
    height_cm: number | null;
    allergies: string | null;
    chronic_conditions: string | null;
    insurance_provider: string | null;
    insurance_policy: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    emergency_contact_relation: string | null;
    general_notes: string | null;
  }) => Promise<void>;
  onCreateProvider: (payload: {
    name: string;
    specialty: string;
    clinic_or_center: string | null;
    city: string | null;
    phone: string | null;
    consultation_fee: number | null;
    address: string | null;
    notes: string | null;
    is_active: boolean;
  }) => Promise<void>;
  onUpdateProvider: (
    providerId: string,
    payload: {
      name: string;
      specialty: string;
      clinic_or_center: string | null;
      city: string | null;
      phone: string | null;
      consultation_fee: number | null;
      address: string | null;
      notes: string | null;
      is_active: boolean;
    }
  ) => Promise<void>;
  onDeleteProvider: (providerId: string) => Promise<void>;
}

export function PatientDossierView({
  snapshot,
  onUpdateProfile,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
}: PatientDossierViewProps) {
  const profile = snapshot.patient_profile;

  // Edicion de Perfil Clinico
  const [editingProfile, setEditingProfile] = useState(false);
  const [fullName, setFullName] = useState(profile.full_name);
  const [birthDate, setBirthDate] = useState(profile.birth_date ?? "");
  const [bloodType, setBloodType] = useState(profile.blood_type ?? "");
  const [weightKg, setWeightKg] = useState(
    profile.weight_kg !== null ? String(profile.weight_kg) : ""
  );
  const [heightCm, setHeightCm] = useState(
    profile.height_cm !== null ? String(profile.height_cm) : ""
  );
  const [allergies, setAllergies] = useState(profile.allergies ?? "");
  const [conditions, setConditions] = useState(
    profile.chronic_conditions ?? ""
  );
  const [insProvider, setInsProvider] = useState(
    profile.insurance_provider ?? ""
  );
  const [insPolicy, setInsPolicy] = useState(profile.insurance_policy ?? "");
  const [emergName, setEmergName] = useState(
    profile.emergency_contact_name ?? ""
  );
  const [emergPhone, setEmergPhone] = useState(
    profile.emergency_contact_phone ?? ""
  );
  const [emergRelation, setEmergRelation] = useState(
    profile.emergency_contact_relation ?? ""
  );
  const [generalNotes, setGeneralNotes] = useState(profile.general_notes ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Directorio Medico CRUD
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(
    null
  );
  const [provName, setProvName] = useState("");
  const [provSpecialty, setProvSpecialty] = useState("");
  const [provClinic, setProvClinic] = useState("");
  const [provCity, setProvCity] = useState("");
  const [provPhone, setProvPhone] = useState("");
  const [provFee, setProvFee] = useState("");
  const [provAddress, setProvAddress] = useState("");
  const [provNotes, setProvNotes] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [confirmDeleteProvId, setConfirmDeleteProvId] = useState<string | null>(
    null
  );

  // Filtro Auditoria + Copiar Resumen
  const [auditFilter, setAuditFilter] = useState("ALL");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setSavingProfile(true);
    try {
      await onUpdateProfile({
        full_name: fullName.trim(),
        birth_date: birthDate || null,
        blood_type: bloodType.trim() || null,
        weight_kg:
          weightKg.trim() !== "" && Number.isFinite(Number(weightKg))
            ? Number(weightKg)
            : null,
        height_cm:
          heightCm.trim() !== "" && Number.isFinite(Number(heightCm))
            ? Number(heightCm)
            : null,
        allergies: allergies.trim() || null,
        chronic_conditions: conditions.trim() || null,
        insurance_provider: insProvider.trim() || null,
        insurance_policy: insPolicy.trim() || null,
        emergency_contact_name: emergName.trim() || null,
        emergency_contact_phone: emergPhone.trim() || null,
        emergency_contact_relation: emergRelation.trim() || null,
        general_notes: generalNotes.trim() || null,
      });
      setEditingProfile(false);
    } finally {
      setSavingProfile(false);
    }
  }

  function resetProviderForm() {
    setEditingProviderId(null);
    setProvName("");
    setProvSpecialty("");
    setProvClinic("");
    setProvCity("");
    setProvPhone("");
    setProvFee("");
    setProvAddress("");
    setProvNotes("");
  }

  function startEditProvider(p: CareProvider) {
    setEditingProviderId(p.id);
    setProvName(p.name);
    setProvSpecialty(p.specialty);
    setProvClinic(p.clinic_or_center ?? "");
    setProvCity(p.city ?? "");
    setProvPhone(p.phone ?? "");
    setProvFee(p.consultation_fee !== null ? String(p.consultation_fee) : "");
    setProvAddress(p.address ?? "");
    setProvNotes(p.notes ?? "");
    setShowProviderForm(true);
  }

  async function handleProviderSubmit(e: FormEvent) {
    e.preventDefault();
    if (!provName.trim() || !provSpecialty.trim()) return;
    const payload = {
      name: provName.trim(),
      specialty: provSpecialty.trim(),
      clinic_or_center: provClinic.trim() || null,
      city: provCity.trim() || null,
      phone: provPhone.trim() || null,
      consultation_fee:
        provFee.trim() !== "" && Number.isFinite(Number(provFee))
          ? Number(provFee)
          : null,
      address: provAddress.trim() || null,
      notes: provNotes.trim() || null,
      is_active: true,
    };
    setSavingProvider(true);
    try {
      if (editingProviderId) {
        await onUpdateProvider(editingProviderId, payload);
      } else {
        await onCreateProvider(payload);
      }
      resetProviderForm();
      setShowProviderForm(false);
    } finally {
      setSavingProvider(false);
    }
  }

  async function handleCopyClinicalSummary() {
    const lines = [
      `RESUMEN CLINICO PARA CONSULTA MEDICA (${snapshot.target_date})`,
      "========================================",
      `Paciente: ${profile.full_name}`,
      profile.birth_date ? `Fecha nacimiento: ${profile.birth_date}` : null,
      profile.blood_type ? `Tipo de sangre: ${profile.blood_type}` : null,
      profile.weight_kg || profile.height_cm
        ? `Peso / Estatura: ${profile.weight_kg ?? "--"} kg / ${profile.height_cm ?? "--"} cm`
        : null,
      `ALERGIAS: ${profile.allergies || "Sin alergias registradas / Por confirmar"}`,
      `Padecimientos / Seguimiento: ${profile.chronic_conditions || "No especificado"}`,
      profile.emergency_contact_name
        ? `Contacto Emergencia: ${profile.emergency_contact_name} (${profile.emergency_contact_relation ?? ""}) Tel: ${profile.emergency_contact_phone ?? "--"}`
        : null,
      "",
      "MEDICACION ACTUAL ACTIVA:",
      ...snapshot.medications.map((m, idx) => {
        const sch =
          m.schedules && m.schedules.length > 0
            ? m.schedules
                .map((s) => formatShortTime(s.effective_clustered_time))
                .join(", ")
            : "Segun evento clinico";
        return `${idx + 1}. ${m.name}${m.active_ingredient ? ` (${m.active_ingredient})` : ""} - ${m.dose_amount} ${m.presentation} | Horarios: ${sch} | Stock: ${m.current_stock ?? "Pendiente"}`;
      }),
      "",
      "PROXIMAS CITAS / ESTUDIOS:",
      ...snapshot.upcoming_events
        .slice(0, 6)
        .map(
          (e) =>
            `- ${e.title} | ${e.event_datetime.slice(0, 10)}${e.specialist_or_center ? ` | ${e.specialist_or_center}` : ""}`
        ),
    ].filter((x): x is string => Boolean(x !== null));

    const summaryText = lines.join("\n");
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopyNotice("[COPIADO] Resumen clinico listo para pegar en WhatsApp o correo del medico.");
    } catch {
      setCopyNotice(summaryText);
    }
  }

  const filteredAudit =
    auditFilter === "ALL"
      ? snapshot.recent_audit_logs
      : snapshot.recent_audit_logs.filter((a) => a.entity_type === auditFilter);

  return (
    <div className="space-y-6 clinical-enter">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-[#0F172A]">
            Expediente Clinico, Directorio Medico y Auditoria
          </h2>
          <p className="text-[14px] text-[#475569]">
            Ficha integral del paciente, adherencia a 30 dias, red de
            especialistas y trazabilidad de cada cambio en el sistema.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyClinicalSummary}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            <Copy
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Copiar Resumen para Consulta
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="clinical-btn inline-flex items-center gap-2 px-3.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#0F172A] text-[14px] font-medium"
          >
            <Printer
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Imprimir Ficha
          </button>

          <button
            type="button"
            onClick={() => setEditingProfile((v) => !v)}
            className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-bold"
          >
            <Edit3 className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            {editingProfile ? "Cancelar Edicion" : "Editar Ficha del Paciente"}
          </button>
        </div>
      </div>

      {copyNotice && (
        <div className="p-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-[6px] text-[13px] font-mono text-[#065F46] whitespace-pre-wrap">
          {copyNotice}
        </div>
      )}

      {/* Alerta de Alergias + Resumen del Paciente */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className={cn(
            "clinical-card p-4 space-y-2",
            profile.allergies
              ? "border-[#FECACA] bg-[#FEF2F2]"
              : "border-[#FDE68A] bg-[#FFFBEB]"
          )}
        >
          <div className="flex items-center gap-2">
            <AlertOctagon
              className={cn(
                "w-5 h-5 shrink-0",
                profile.allergies ? "text-[#991B1B]" : "text-[#92400E]"
              )}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h3
              className={cn(
                "text-[15px] font-bold",
                profile.allergies ? "text-[#991B1B]" : "text-[#92400E]"
              )}
            >
              Alergias y Precauciones Criticas
            </h3>
          </div>
          <p
            className={cn(
              "text-[14px]",
              profile.allergies ? "text-[#7F1D1D] font-semibold" : "text-[#78350F]"
            )}
          >
            {profile.allergies ||
              "Sin alergias registradas todavia. Edita la ficha para confirmar si existen alergias farmacologicas."}
          </p>
        </div>

        <div className="clinical-card p-4 space-y-1.5">
          <div className="flex items-center gap-2">
            <FileText
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h3 className="text-[15px] font-bold text-[#0F172A]">
              {profile.full_name}
            </h3>
          </div>
          <p className="font-mono text-[13px] text-[#475569] tabular-nums">
            Sangre: {profile.blood_type || "Pendiente"} | Peso:{" "}
            {profile.weight_kg ? `${profile.weight_kg} kg` : "--"} | Estatura:{" "}
            {profile.height_cm ? `${profile.height_cm} cm` : "--"}
          </p>
          <p className="text-[13px] text-[#334155]">
            <strong>Diagnosticos / Seguimiento:</strong>{" "}
            {profile.chronic_conditions || "Por completar"}
          </p>
          {profile.insurance_provider && (
            <p className="font-mono text-[12px] text-[#475569]">
              Seguro: {profile.insurance_provider} (Poliza:{" "}
              {profile.insurance_policy || "--"})
            </p>
          )}
        </div>

        <div className="clinical-card p-4 space-y-1.5">
          <div className="flex items-center gap-2">
            <ShieldAlert
              className="w-4 h-4 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h3 className="text-[15px] font-bold text-[#0F172A]">
              Contacto de Emergencia
            </h3>
          </div>
          <p className="text-[14px] font-bold text-[#0F172A]">
            {profile.emergency_contact_name || "Pendiente de asignar"}
          </p>
          <p className="font-mono text-[14px] text-[#0E7490] tabular-nums">
            {profile.emergency_contact_phone || "Sin telefono registrado"}
          </p>
          <p className="text-[13px] text-[#475569]">
            Parentesco: {profile.emergency_contact_relation || "--"}
          </p>
        </div>
      </section>

      {/* Formulario de Edicion del Expediente */}
      {editingProfile && (
        <form
          onSubmit={handleProfileSubmit}
          className="clinical-card p-5 space-y-4 border-[#A5F3FC]"
        >
          <h3 className="text-[16px] font-bold text-[#0F172A] border-b border-[#E2E8F0] pb-2.5">
            Actualizar Ficha Clinica del Paciente
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Nombre completo del paciente *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Fecha de nacimiento
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Tipo de sangre
              </label>
              <input
                type="text"
                placeholder="Ej. O+"
                value={bloodType}
                onChange={(e) => setBloodType(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Peso (kg)
              </label>
              <input
                type="number"
                step="0.1"
                min="1"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Estatura (cm)
              </label>
              <input
                type="number"
                step="0.5"
                min="30"
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Alergias a medicamentos / alimentos
              </label>
              <input
                type="text"
                placeholder="Ej. Penicilina / Ninguna conocida"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Diagnosticos y padecimientos cronicos
              </label>
              <textarea
                rows={2}
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
                className="w-full p-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Aseguradora / Seguridad Social
              </label>
              <input
                type="text"
                value={insProvider}
                onChange={(e) => setInsProvider(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Numero de poliza / NSS
              </label>
              <input
                type="text"
                value={insPolicy}
                onChange={(e) => setInsPolicy(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Contacto de emergencia (Nombre)
              </label>
              <input
                type="text"
                value={emergName}
                onChange={(e) => setEmergName(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Telefono de emergencia
              </label>
              <input
                type="text"
                value={emergPhone}
                onChange={(e) => setEmergPhone(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Parentesco / Relacion
              </label>
              <input
                type="text"
                value={emergRelation}
                onChange={(e) => setEmergRelation(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                Notas clinicas generales
              </label>
              <input
                type="text"
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
                className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditingProfile(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingProfile}
              className="clinical-btn px-5 bg-[#0E7490] text-white text-[14px] font-bold"
            >
              {savingProfile ? "Guardando..." : "Guardar Ficha"}
            </button>
          </div>
        </form>
      )}

      {/* Adherencia ultimos 30 dias */}
      <section className="clinical-card p-5 space-y-3">
        <div className="flex items-center gap-2 border-b border-[#E2E8F0] pb-2.5">
          <Activity
            className="w-4 h-4 text-[#0E7490]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <h3 className="text-[16px] font-bold text-[#0F172A]">
            Adherencia Farmacologica (Ultimos 30 Dias)
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {snapshot.adherence_30d.map((ad) => (
            <div
              key={ad.medication_id}
              className="border border-[#E2E8F0] rounded-[6px] p-3 bg-[#F8FAFC] space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[14px] text-[#0F172A] truncate">
                  {ad.medication_name}
                </span>
                <span className="font-mono text-[14px] font-bold text-[#0E7490] tabular-nums">
                  {ad.adherence_pct}%
                </span>
              </div>
              <div className="h-2 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0E7490]"
                  style={{ width: `${Math.min(100, ad.adherence_pct)}%` }}
                />
              </div>
              <p className="font-mono text-[12px] text-[#475569] tabular-nums">
                Tomadas: {ad.taken_count}/{ad.total_count} | Posp:{" "}
                {ad.delayed_count} | Omit: {ad.skipped_count}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Directorio de Medicos, Laboratorios y Farmacias (CRUD) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Stethoscope
              className="w-5 h-5 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h3 className="text-[18px] font-bold text-[#0F172A]">
              Directorio de Especialistas, Laboratorios y Farmacias (
              {snapshot.care_providers.length})
            </h3>
          </div>

          <button
            type="button"
            onClick={() => {
              if (showProviderForm && !editingProviderId) {
                setShowProviderForm(false);
              } else {
                resetProviderForm();
                setShowProviderForm(true);
              }
            }}
            className="clinical-btn inline-flex items-center gap-2 px-4 bg-[#0E7490] text-white text-[14px] font-bold"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            {showProviderForm ? "Cerrar" : "Agregar Especialista / Centro"}
          </button>
        </div>

        {showProviderForm && (
          <form
            onSubmit={handleProviderSubmit}
            className="clinical-card p-5 space-y-4 border-[#A5F3FC]"
          >
            <h4 className="text-[16px] font-bold text-[#0F172A]">
              {editingProviderId
                ? `Editar Proveedor: ${provName}`
                : "Nuevo Especialista, Laboratorio o Farmacia"}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                  Nombre del medico o centro *
                </label>
                <input
                  type="text"
                  required
                  value={provName}
                  onChange={(e) => setProvName(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                  Especialidad / Tipo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Reumatologia / Farmacia"
                  value={provSpecialty}
                  onChange={(e) => setProvSpecialty(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                  Clinica / Hospital
                </label>
                <input
                  type="text"
                  value={provClinic}
                  onChange={(e) => setProvClinic(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                  Ciudad
                </label>
                <input
                  type="text"
                  value={provCity}
                  onChange={(e) => setProvCity(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                  Telefono
                </label>
                <input
                  type="text"
                  value={provPhone}
                  onChange={(e) => setProvPhone(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                  Costo de consulta / estudio (MXN)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={provFee}
                  onChange={(e) => setProvFee(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] font-mono text-[14px]"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                  Direccion
                </label>
                <input
                  type="text"
                  value={provAddress}
                  onChange={(e) => setProvAddress(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[13px] font-medium text-[#0F172A] mb-1">
                  Notas y horarios de atencion
                </label>
                <input
                  type="text"
                  value={provNotes}
                  onChange={(e) => setProvNotes(e.target.value)}
                  className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-[6px] text-[14px]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowProviderForm(false);
                  resetProviderForm();
                }}
                className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingProvider}
                className="clinical-btn px-5 bg-[#0E7490] text-white text-[14px] font-bold"
              >
                {savingProvider
                  ? "Guardando..."
                  : editingProviderId
                  ? "Actualizar Especialista"
                  : "Guardar Especialista"}
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {snapshot.care_providers.map((prov) => (
            <article
              key={prov.id}
              className="clinical-card p-4 flex flex-col justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <StatusBadge label={prov.specialty} tone="info" />
                  {prov.consultation_fee !== null && (
                    <span className="font-mono font-bold text-[14px] text-[#0F172A] tabular-nums">
                      {formatCurrencyMxn(prov.consultation_fee)}
                    </span>
                  )}
                </div>
                <h4 className="text-[16px] font-bold text-[#0F172A]">
                  {prov.name}
                </h4>
                {(prov.clinic_or_center || prov.city) && (
                  <p className="text-[13px] text-[#475569]">
                    {[prov.clinic_or_center, prov.city]
                      .filter(Boolean)
                      .join(" | ")}
                  </p>
                )}
                {prov.phone && (
                  <p className="inline-flex items-center gap-1.5 font-mono text-[13px] text-[#0E7490]">
                    <Phone
                      className="w-3.5 h-3.5"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    {prov.phone}
                  </p>
                )}
                {prov.notes && (
                  <p className="text-[13px] text-[#64748B]">{prov.notes}</p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#F1F5F9]">
                <button
                  type="button"
                  onClick={() => startEditProvider(prov)}
                  className="clinical-btn inline-flex items-center gap-1 px-3 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[13px]"
                >
                  <Edit3
                    className="w-3.5 h-3.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  Editar
                </button>
                {confirmDeleteProvId === prov.id ? (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        await onDeleteProvider(prov.id);
                        setConfirmDeleteProvId(null);
                      }}
                      className="clinical-btn px-3 bg-[#991B1B] text-white text-[13px] font-bold"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteProvId(null)}
                      className="clinical-btn px-2.5 border border-[#CBD5E1] bg-white text-[13px]"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteProvId(prov.id)}
                    className="clinical-btn px-2.5 border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#991B1B]"
                    aria-label={`Eliminar proveedor ${prov.name}`}
                  >
                    <Trash2
                      className="w-3.5 h-3.5"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Bitacora de Auditoria y Gobernanza */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History
              className="w-5 h-5 text-[#0E7490]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h3 className="text-[18px] font-bold text-[#0F172A]">
              Bitacora de Auditoria y Gobernanza ({filteredAudit.length})
            </h3>
          </div>

          <select
            aria-label="Filtrar auditoria por modulo"
            value={auditFilter}
            onChange={(e) => setAuditFilter(e.target.value)}
            className="h-[42px] px-3 border border-[#CBD5E1] rounded-[6px] bg-white text-[14px]"
          >
            <option value="ALL">Todos los modulos</option>
            <option value="MEDICATION">Medicamentos</option>
            <option value="INTAKE_CLUSTER">Bloques Horarios</option>
            <option value="INTAKE_LOG">Registros de Toma</option>
            <option value="CLINICAL_EVENT">Eventos Clinicos</option>
            <option value="FOLLOW_UP_TOPIC">Temas de Seguimiento</option>
            <option value="EXPENSE">Gastos Medicos</option>
            <option value="FINANCIAL_SETTINGS">Config. Quincenal</option>
            <option value="PATIENT_PROFILE">Ficha del Paciente</option>
            <option value="CARE_PROVIDER">Especialistas</option>
            <option value="TELEGRAM_RECIPIENT">Telegram</option>
          </select>
        </div>

        <div className="clinical-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[13px] font-semibold text-[#475569]">
                  <th className="py-2.5 px-4">Fecha / Hora</th>
                  <th className="py-2.5 px-3">Accion / Modulo</th>
                  <th className="py-2.5 px-3">Entidad</th>
                  <th className="py-2.5 px-3">Resumen de Gobernanza</th>
                  <th className="py-2.5 px-4">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {filteredAudit.map((log) => (
                  <tr key={log.id} className="bg-white text-[13px]">
                    <td className="py-2.5 px-4 font-mono text-[#475569] tabular-nums whitespace-nowrap">
                      {formatDateTimeEs(log.created_at)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <StatusBadge
                        label={AUDIT_ACTION_TAG[log.action] ?? `[${log.action}]`}
                        tone={
                          log.action === "DELETE" || log.action === "ARCHIVE"
                            ? "crit"
                            : log.action === "CREATE" ||
                              log.action === "PURCHASE_EXECUTED"
                            ? "ok"
                            : "info"
                        }
                      />
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-[#0F172A]">
                      {log.entity_label}
                    </td>
                    <td className="py-2.5 px-3 text-[#334155]">{log.summary}</td>
                    <td className="py-2.5 px-4 font-mono text-[#64748B]">
                      {log.actor}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
