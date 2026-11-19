"use client";

import { useState, type FormEvent } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  Edit3,
  FileHeart,
  History,
  KeyRound,
  Phone,
  Plus,
  ShieldCheck,
  Stethoscope,
  Trash2,
} from "lucide-react";
import type {
  AuthUserPublic,
  CareProvider,
  CommandCenterSnapshot,
  Medication,
} from "@/lib/types/clinical";
import {
  AUDIT_ACTION_TAG,
  VERSION_ACTION_LABEL,
} from "@/lib/clinical-labels";
import {
  cn,
  formatCurrencyMxn,
  formatDateOnlyEs,
  formatDateTimeEs,
} from "@/lib/utils";
import { ClinicalModal } from "./ClinicalModal";
import { IconActionButton } from "./IconActionButton";
import { MedicationVersionsModal } from "./MedicationVersionsModal";
import { StatusBadge } from "./StatusBadge";

interface PatientDossierViewProps {
  snapshot: CommandCenterSnapshot;
  isAdmin: boolean;
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
  onUpdateAuthUser: (
    userId: string,
    payload: {
      username?: string;
      display_name?: string;
      new_password?: string;
    }
  ) => Promise<void>;
  onRestoreVersion: (medicationId: string, versionId: string) => Promise<void>;
  onMarkVersionReviewed: (versionId: string) => Promise<void>;
}

function parseOptionalPos(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseOptionalNonNeg(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function PatientDossierView({
  snapshot,
  isAdmin,
  onUpdateProfile,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
  onUpdateAuthUser,
  onRestoreVersion,
  onMarkVersionReviewed,
}: PatientDossierViewProps) {
  const profile = snapshot.patient_profile;

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDeleteProviderId, setConfirmDeleteProviderId] = useState<
    string | null
  >(null);

  // Modal Perfil (re-sincronizado al abrir)
  const [profileOpen, setProfileOpen] = useState(false);
  const [pFullName, setPFullName] = useState("");
  const [pBirthDate, setPBirthDate] = useState("");
  const [pBloodType, setPBloodType] = useState("");
  const [pWeight, setPWeight] = useState("");
  const [pHeight, setPHeight] = useState("");
  const [pAllergies, setPAllergies] = useState("");
  const [pConditions, setPConditions] = useState("");
  const [pInsurance, setPInsurance] = useState("");
  const [pPolicy, setPPolicy] = useState("");
  const [pEmName, setPEmName] = useState("");
  const [pEmPhone, setPEmPhone] = useState("");
  const [pEmRelation, setPEmRelation] = useState("");
  const [pNotes, setPNotes] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Modal Especialista
  const [providerOpen, setProviderOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<CareProvider | null>(
    null
  );
  const [prName, setPrName] = useState("");
  const [prSpecialty, setPrSpecialty] = useState("");
  const [prClinic, setPrClinic] = useState("");
  const [prCity, setPrCity] = useState("");
  const [prPhone, setPrPhone] = useState("");
  const [prFee, setPrFee] = useState("");
  const [prAddress, setPrAddress] = useState("");
  const [prNotes, setPrNotes] = useState("");
  const [prActive, setPrActive] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);

  // Modal Versiones de Medicamento (Solo Admin)
  const [versionsTarget, setVersionsTarget] = useState<Medication | null>(null);

  // Modal Editar Credenciales de Acceso (Solo Admin)
  const [editingUser, setEditingUser] = useState<AuthUserPublic | null>(null);
  const [uUsername, setUUsername] = useState("");
  const [uDisplayName, setUDisplayName] = useState("");
  const [uPassword, setUPassword] = useState("");
  const [userError, setUserError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  function openProfileModal() {
    const p = snapshot.patient_profile;
    setPFullName(p.full_name);
    setPBirthDate(p.birth_date ? p.birth_date.slice(0, 10) : "");
    setPBloodType(p.blood_type ?? "");
    setPWeight(p.weight_kg === null ? "" : String(p.weight_kg));
    setPHeight(p.height_cm === null ? "" : String(p.height_cm));
    setPAllergies(p.allergies ?? "");
    setPConditions(p.chronic_conditions ?? "");
    setPInsurance(p.insurance_provider ?? "");
    setPPolicy(p.insurance_policy ?? "");
    setPEmName(p.emergency_contact_name ?? "");
    setPEmPhone(p.emergency_contact_phone ?? "");
    setPEmRelation(p.emergency_contact_relation ?? "");
    setPNotes(p.general_notes ?? "");
    setProfileError(null);
    setProfileOpen(true);
  }

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);
    if (!pFullName.trim()) {
      setProfileError("Ingresa el nombre completo del paciente.");
      return;
    }
    setSavingProfile(true);
    try {
      await onUpdateProfile({
        full_name: pFullName.trim(),
        birth_date: pBirthDate.trim() || null,
        blood_type: pBloodType.trim() || null,
        weight_kg: parseOptionalPos(pWeight),
        height_cm: parseOptionalPos(pHeight),
        allergies: pAllergies.trim() || null,
        chronic_conditions: pConditions.trim() || null,
        insurance_provider: pInsurance.trim() || null,
        insurance_policy: pPolicy.trim() || null,
        emergency_contact_name: pEmName.trim() || null,
        emergency_contact_phone: pEmPhone.trim() || null,
        emergency_contact_relation: pEmRelation.trim() || null,
        general_notes: pNotes.trim() || null,
      });
      setProfileOpen(false);
    } catch (err) {
      setProfileError(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar el expediente."
      );
    } finally {
      setSavingProfile(false);
    }
  }

  function openCreateProvider() {
    setEditingProvider(null);
    setPrName("");
    setPrSpecialty("");
    setPrClinic("");
    setPrCity("CDMX");
    setPrPhone("");
    setPrFee("");
    setPrAddress("");
    setPrNotes("");
    setPrActive(true);
    setProviderError(null);
    setProviderOpen(true);
  }

  function openEditProvider(pr: CareProvider) {
    setEditingProvider(pr);
    setPrName(pr.name);
    setPrSpecialty(pr.specialty);
    setPrClinic(pr.clinic_or_center ?? "");
    setPrCity(pr.city ?? "");
    setPrPhone(pr.phone ?? "");
    setPrFee(pr.consultation_fee === null ? "" : String(pr.consultation_fee));
    setPrAddress(pr.address ?? "");
    setPrNotes(pr.notes ?? "");
    setPrActive(pr.is_active);
    setProviderError(null);
    setProviderOpen(true);
  }

  async function handleProviderSubmit(e: FormEvent) {
    e.preventDefault();
    setProviderError(null);
    if (!prName.trim() || !prSpecialty.trim()) {
      setProviderError("Nombre y especialidad son obligatorios.");
      return;
    }
    const payload = {
      name: prName.trim(),
      specialty: prSpecialty.trim(),
      clinic_or_center: prClinic.trim() || null,
      city: prCity.trim() || null,
      phone: prPhone.trim() || null,
      consultation_fee: parseOptionalNonNeg(prFee),
      address: prAddress.trim() || null,
      notes: prNotes.trim() || null,
      is_active: prActive,
    };
    setSavingProvider(true);
    try {
      if (editingProvider) {
        await onUpdateProvider(editingProvider.id, payload);
      } else {
        await onCreateProvider(payload);
      }
      setProviderOpen(false);
    } catch (err) {
      setProviderError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar el especialista."
      );
    } finally {
      setSavingProvider(false);
    }
  }

  function openEditAuthUser(user: AuthUserPublic) {
    setEditingUser(user);
    setUUsername(user.username);
    setUDisplayName(user.display_name);
    setUPassword("");
    setUserError(null);
  }

  async function handleAuthUserSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setUserError(null);
    if (!uUsername.trim() || !uDisplayName.trim()) {
      setUserError("Usuario y nombre visible son obligatorios.");
      return;
    }
    if (uPassword.trim() && uPassword.trim().length < 6) {
      setUserError("La nueva contrasena debe tener al menos 6 caracteres.");
      return;
    }
    setSavingUser(true);
    try {
      await onUpdateAuthUser(editingUser.id, {
        username: uUsername.trim(),
        display_name: uDisplayName.trim(),
        ...(uPassword.trim() ? { new_password: uPassword.trim() } : {}),
      });
      setEditingUser(null);
    } catch (err) {
      setUserError(
        err instanceof Error
          ? err.message
          : "No se pudieron actualizar las credenciales."
      );
    } finally {
      setSavingUser(false);
    }
  }

  const allMedsById = new Map<string, Medication>();
  for (const m of [...snapshot.medications, ...snapshot.archived_medications]) {
    allMedsById.set(m.id, m);
  }

  const unreviewedVersionsCount = isAdmin
    ? snapshot.medication_versions.filter(
        (v) => v.changed_by_role === "PATIENT" && !v.reviewed_by_admin
      ).length
    : 0;

  return (
    <div className="space-y-5 clinical-enter">
      {/* Ficha Clinica del Paciente */}
      <section className="clinical-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-[6px] bg-[#ECFEFF] border border-[#A5F3FC] flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <FileHeart className="w-5 h-5 text-[#0E7490]" />
            </div>
            <div>
              <h2 className="text-[20px] font-bold text-[#0F172A]">
                Expediente Clinico: {profile.full_name}
              </h2>
              <p className="mt-0.5 text-[13px] text-[#475569] font-mono tabular-nums">
                Actualizado: {formatDateTimeEs(profile.updated_at)}
              </p>
            </div>
          </div>

          <IconActionButton
            icon={Edit3}
            label="Editar ficha clinica del paciente"
            shortLabel="Editar Ficha"
            tone="primary"
            onClick={openProfileModal}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-2 border-t border-[#E2E8F0] text-[14px]">
          <div className="p-3 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0]">
            <span className="text-[12px] text-[#64748B] block">
              Fecha de nacimiento / Sangre
            </span>
            <strong className="font-mono text-[#0F172A]">
              {profile.birth_date
                ? formatDateOnlyEs(profile.birth_date)
                : "No registrada"}{" "}
              | {profile.blood_type ?? "--"}
            </strong>
          </div>

          <div className="p-3 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0]">
            <span className="text-[12px] text-[#64748B] block">
              Peso y Estatura
            </span>
            <strong className="font-mono text-[#0F172A]">
              {profile.weight_kg !== null ? `${profile.weight_kg} kg` : "--"} |{" "}
              {profile.height_cm !== null ? `${profile.height_cm} cm` : "--"}
            </strong>
          </div>

          <div className="p-3 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0]">
            <span className="text-[12px] text-[#64748B] block">
              Seguro Medico / Poliza
            </span>
            <strong className="text-[#0F172A]">
              {profile.insurance_provider ?? "Sin seguro registrado"}
              {profile.insurance_policy ? ` (${profile.insurance_policy})` : ""}
            </strong>
          </div>

          <div className="p-3 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0]">
            <span className="text-[12px] text-[#64748B] block">
              Contacto de Emergencia
            </span>
            <strong className="text-[#0F172A]">
              {profile.emergency_contact_name ?? "No registrado"}
              {profile.emergency_contact_phone
                ? ` | ${profile.emergency_contact_phone}`
                : ""}
            </strong>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-[14px]">
          <div className="p-3.5 rounded-[6px] border border-[#FECACA] bg-[#FEF2F2]/40">
            <span className="text-[12px] font-bold text-[#991B1B] block mb-1">
              Alergias Conocidas
            </span>
            <p className="text-[#0F172A]">
              {profile.allergies || "Sin alergias registradas"}
            </p>
          </div>

          <div className="p-3.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC]">
            <span className="text-[12px] font-bold text-[#0F172A] block mb-1">
              Padecimientos Cronicos / Diagnosticos
            </span>
            <p className="text-[#334155]">
              {profile.chronic_conditions || "Sin registro"}
            </p>
          </div>

          <div className="p-3.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC]">
            <span className="text-[12px] font-bold text-[#0F172A] block mb-1">
              Notas Generales de Cuidado
            </span>
            <p className="text-[#334155]">
              {profile.general_notes || "Sin notas adicionales"}
            </p>
          </div>
        </div>
      </section>

      {/* Adherencia Terapeutica 30 Dias */}
      <section className="clinical-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#0E7490]" aria-hidden="true" />
          <h3 className="text-[17px] font-bold text-[#0F172A]">
            Adherencia Terapeutica (Ultimos 30 Dias)
          </h3>
        </div>

        {snapshot.adherence_30d.length === 0 ? (
          <p className="text-[14px] text-[#475569]">
            Sin registros de tomas en los ultimos 30 dias.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {snapshot.adherence_30d.map((item) => (
              <div
                key={item.medication_id}
                className="p-3.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[14px] text-[#0F172A] truncate">
                    {item.medication_name}
                  </span>
                  <StatusBadge
                    label={`${item.adherence_pct}%`}
                    tone={
                      item.adherence_pct >= 85
                        ? "ok"
                        : item.adherence_pct >= 65
                        ? "warn"
                        : "crit"
                    }
                  />
                </div>
                <div className="h-2 rounded-full bg-[#E2E8F0] overflow-hidden">
                  <div
                    className={cn(
                      "h-full",
                      item.adherence_pct >= 85
                        ? "bg-[#059669]"
                        : item.adherence_pct >= 65
                        ? "bg-[#D97706]"
                        : "bg-[#DC2626]"
                    )}
                    style={{ width: `${Math.min(100, item.adherence_pct)}%` }}
                  />
                </div>
                <p className="font-mono text-[12px] text-[#475569] tabular-nums">
                  Tomadas: {item.taken_count} | Pospuestas: {item.delayed_count}{" "}
                  | Omitidas: {item.skipped_count}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Directorio de Especialistas */}
      <section className="clinical-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Stethoscope
              className="w-5 h-5 text-[#0E7490]"
              aria-hidden="true"
            />
            <h3 className="text-[17px] font-bold text-[#0F172A]">
              Directorio de Medicos y Especialistas ({snapshot.care_providers.length})
            </h3>
          </div>
          <IconActionButton
            icon={Plus}
            label="Agregar medico o especialista al directorio"
            shortLabel="Nuevo Especialista"
            tone="primary"
            onClick={openCreateProvider}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {snapshot.care_providers.map((pr) => {
            const isConfirmDel = confirmDeleteProviderId === pr.id;
            return (
              <article
                key={pr.id}
                className="p-4 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] flex items-start justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-[15px] text-[#0F172A]">
                      {pr.name}
                    </h4>
                    <StatusBadge label={`[${pr.specialty}]`} tone="info" />
                  </div>
                  <p className="text-[13px] text-[#334155]">
                    {[pr.clinic_or_center, pr.city].filter(Boolean).join(" | ")}
                  </p>
                  {pr.phone && (
                    <p className="text-[13px] text-[#0E7490] font-mono inline-flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                      {pr.phone}
                    </p>
                  )}
                  {pr.consultation_fee !== null && (
                    <p className="text-[13px] text-[#475569] font-mono">
                      Consulta: {formatCurrencyMxn(pr.consultation_fee)}
                    </p>
                  )}
                  {pr.notes && (
                    <p className="text-[12px] text-[#64748B]">{pr.notes}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <IconActionButton
                    icon={Edit3}
                    label={`Editar especialista ${pr.name}`}
                    tone="neutral"
                    onClick={() => openEditProvider(pr)}
                  />
                  {isAdmin &&
                    (isConfirmDel ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyKey === `del-pr:${pr.id}`}
                          onClick={async () => {
                            setBusyKey(`del-pr:${pr.id}`);
                            try {
                              await onDeleteProvider(pr.id);
                              setConfirmDeleteProviderId(null);
                            } catch {
                              // Toast
                            } finally {
                              setBusyKey(null);
                            }
                          }}
                          className="clinical-btn px-2.5 bg-[#991B1B] text-white text-[12px] font-bold"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProviderId(null)}
                          className="clinical-btn px-2 border border-[#CBD5E1] bg-white text-[#334155] text-[12px]"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <IconActionButton
                        icon={Trash2}
                        label={`Eliminar especialista ${pr.name}`}
                        tone="danger"
                        onClick={() => setConfirmDeleteProviderId(pr.id)}
                      />
                    ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* SECCIONES EXCLUSIVAS DE ADMINISTRADOR (Ocultas en modo sigiloso para Paciente) */}
      {isAdmin && (
        <>
          {/* 1. Control de Versiones y Cambios en Medicamentos */}
          <section className="clinical-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <History
                  className="w-5 h-5 text-[#0E7490]"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-[17px] font-bold text-[#0F172A]">
                    Control de Cambios y Versiones en Medicamentos
                  </h3>
                  <p className="text-[13px] text-[#475569]">
                    Revision y restauracion de ediciones o restocks realizados
                    por el paciente o administradores.
                  </p>
                </div>
              </div>
              {unreviewedVersionsCount > 0 && (
                <StatusBadge
                  label={`[${unreviewedVersionsCount} CAMBIOS DEL PACIENTE POR REVISAR]`}
                  tone="crit"
                />
              )}
            </div>

            {snapshot.medication_versions.length === 0 ? (
              <p className="text-[14px] text-[#475569]">
                No hay cambios registrados todavia.
              </p>
            ) : (
              <div className="space-y-2.5">
                {snapshot.medication_versions.slice(0, 12).map((ver) => {
                  const med = allMedsById.get(ver.medication_id) ?? null;
                  const unreviewed =
                    ver.changed_by_role === "PATIENT" && !ver.reviewed_by_admin;
                  return (
                    <div
                      key={ver.id}
                      className={cn(
                        "p-3.5 rounded-[6px] border flex flex-wrap items-center justify-between gap-3",
                        unreviewed
                          ? "border-[#F59E0B] bg-[#FFFBEB]"
                          : "border-[#E2E8F0] bg-[#F8FAFC]"
                      )}
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12px] font-bold px-2 py-0.5 rounded-[4px] bg-white border border-[#CBD5E1] text-[#0F172A]">
                            v{ver.version_number}
                          </span>
                          <span className="font-bold text-[14px] text-[#0F172A]">
                            {ver.medication_name ??
                              med?.name ??
                              ver.snapshot_json.name}
                          </span>
                          <span className="text-[13px] text-[#334155]">
                            ({VERSION_ACTION_LABEL[ver.change_action] ??
                              ver.change_action})
                          </span>
                          <StatusBadge
                            label={
                              ver.changed_by_role === "PATIENT"
                                ? "[PACIENTE]"
                                : "[ADMIN]"
                            }
                            tone={
                              ver.changed_by_role === "PATIENT"
                                ? "warn"
                                : "info"
                            }
                          />
                          {unreviewed && (
                            <StatusBadge
                              label="[PENDIENTE REVISION]"
                              tone="crit"
                            />
                          )}
                        </div>
                        <p className="text-[13px] text-[#334155]">
                          {ver.change_summary}
                        </p>
                        <p className="text-[12px] text-[#64748B] font-mono tabular-nums">
                          {formatDateTimeEs(ver.created_at)} | Actor:{" "}
                          {ver.changed_by_actor}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {unreviewed && (
                          <IconActionButton
                            icon={Check}
                            label="Marcar cambio como revisado"
                            shortLabel="Revisado"
                            tone="success"
                            loading={busyKey === `rev:${ver.id}`}
                            onClick={async () => {
                              setBusyKey(`rev:${ver.id}`);
                              try {
                                await onMarkVersionReviewed(ver.id);
                              } catch {
                                // Toast
                              } finally {
                                setBusyKey(null);
                              }
                            }}
                          />
                        )}
                        {med && (
                          <IconActionButton
                            icon={History}
                            label={`Abrir historial y restaurar version de ${med.name}`}
                            shortLabel="Versiones"
                            tone="neutral"
                            onClick={() => setVersionsTarget(med)}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. Cuentas de Acceso (Paciente y Administrador) */}
          <section className="clinical-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-[#0E7490]" aria-hidden="true" />
              <div>
                <h3 className="text-[17px] font-bold text-[#0F172A]">
                  Cuentas de Acceso al Sistema
                </h3>
                <p className="text-[13px] text-[#475569]">
                  Administra los usuarios y contrasenas de inicio de sesion para
                  el Paciente y el Administrador.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {snapshot.auth_users.map((user) => (
                <div
                  key={user.id}
                  className="p-4 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[15px] text-[#0F172A]">
                        {user.display_name}
                      </span>
                      <StatusBadge
                        label={
                          user.role === "ADMIN"
                            ? "[ADMINISTRADOR]"
                            : "[PACIENTE]"
                        }
                        tone={user.role === "ADMIN" ? "info" : "ok"}
                      />
                    </div>
                    <p className="text-[13px] text-[#475569] font-mono">
                      Usuario: <strong>{user.username}</strong>
                    </p>
                  </div>

                  <IconActionButton
                    icon={Edit3}
                    label={`Cambiar usuario o contrasena de ${user.display_name}`}
                    shortLabel="Cambiar Clave"
                    tone="neutral"
                    onClick={() => openEditAuthUser(user)}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* 3. Bitacora de Auditoria */}
          <section className="clinical-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="w-5 h-5 text-[#0E7490]"
                aria-hidden="true"
              />
              <h3 className="text-[17px] font-bold text-[#0F172A]">
                Bitacora de Gobernanza y Auditoria ({snapshot.recent_audit_logs.length})
              </h3>
            </div>

            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {snapshot.recent_audit_logs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2 text-[13px]"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <StatusBadge
                      label={AUDIT_ACTION_TAG[log.action] ?? `[${log.action}]`}
                      tone="neutral"
                    />
                    <span className="font-semibold text-[#0F172A]">
                      {log.entity_label}
                    </span>
                    <span className="text-[#334155]">{log.summary}</span>
                  </div>
                  <span className="font-mono text-[12px] text-[#64748B] tabular-nums">
                    {log.actor} | {formatDateTimeEs(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Modal: Editar Ficha Clinica */}
      <ClinicalModal
        open={profileOpen}
        onClose={() => !savingProfile && setProfileOpen(false)}
        title="Editar Expediente Clinico del Paciente"
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          {profileError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px] flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{profileError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="sm:col-span-2">
              <label
                htmlFor="pf-name"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Nombre completo *
              </label>
              <input
                id="pf-name"
                type="text"
                required
                value={pFullName}
                onChange={(e) => setPFullName(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-birth"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Fecha de nacimiento
              </label>
              <input
                id="pf-birth"
                type="date"
                value={pBirthDate}
                onChange={(e) => setPBirthDate(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-blood"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Tipo de sangre
              </label>
              <input
                id="pf-blood"
                type="text"
                value={pBloodType}
                onChange={(e) => setPBloodType(e.target.value)}
                placeholder="Ej. O+"
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-weight"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Peso (kg)
              </label>
              <input
                id="pf-weight"
                type="number"
                step="0.1"
                min="1"
                value={pWeight}
                onChange={(e) => setPWeight(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-height"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Estatura (cm)
              </label>
              <input
                id="pf-height"
                type="number"
                step="0.1"
                min="30"
                value={pHeight}
                onChange={(e) => setPHeight(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-ins"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Aseguradora / Institucion
              </label>
              <input
                id="pf-ins"
                type="text"
                value={pInsurance}
                onChange={(e) => setPInsurance(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-pol"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Poliza / Afiliacion
              </label>
              <input
                id="pf-pol"
                type="text"
                value={pPolicy}
                onChange={(e) => setPPolicy(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-em-name"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Contacto emergencia
              </label>
              <input
                id="pf-em-name"
                type="text"
                value={pEmName}
                onChange={(e) => setPEmName(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-em-phone"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Telefono emergencia
              </label>
              <input
                id="pf-em-phone"
                type="tel"
                value={pEmPhone}
                onChange={(e) => setPEmPhone(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pf-em-rel"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Parentesco
              </label>
              <input
                id="pf-em-rel"
                type="text"
                value={pEmRelation}
                onChange={(e) => setPEmRelation(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="pf-allergies"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Alergias
            </label>
            <input
              id="pf-allergies"
              type="text"
              value={pAllergies}
              onChange={(e) => setPAllergies(e.target.value)}
              className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
            />
          </div>

          <div>
            <label
              htmlFor="pf-conditions"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Padecimientos cronicos y diagnosticos
            </label>
            <textarea
              id="pf-conditions"
              rows={2}
              value={pConditions}
              onChange={(e) => setPConditions(e.target.value)}
              className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]"
            />
          </div>

          <div>
            <label
              htmlFor="pf-notes"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Notas generales de cuidado
            </label>
            <textarea
              id="pf-notes"
              rows={2}
              value={pNotes}
              onChange={(e) => setPNotes(e.target.value)}
              className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setProfileOpen(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingProfile}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold"
            >
              {savingProfile ? "Guardando..." : "Guardar Expediente"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Especialista */}
      <ClinicalModal
        open={providerOpen}
        onClose={() => !savingProvider && setProviderOpen(false)}
        title={
          editingProvider
            ? `Editar Especialista: ${editingProvider.name}`
            : "Agregar Especialista al Directorio"
        }
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleProviderSubmit} className="space-y-4">
          {providerError && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
            >
              {providerError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="pr-name"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Nombre del medico *
              </label>
              <input
                id="pr-name"
                type="text"
                required
                value={prName}
                onChange={(e) => setPrName(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pr-spec"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Especialidad *
              </label>
              <input
                id="pr-spec"
                type="text"
                required
                value={prSpecialty}
                onChange={(e) => setPrSpecialty(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pr-clinic"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Clinica / Hospital
              </label>
              <input
                id="pr-clinic"
                type="text"
                value={prClinic}
                onChange={(e) => setPrClinic(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pr-city"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Ciudad
              </label>
              <input
                id="pr-city"
                type="text"
                value={prCity}
                onChange={(e) => setPrCity(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pr-phone"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Telefono
              </label>
              <input
                id="pr-phone"
                type="tel"
                value={prPhone}
                onChange={(e) => setPrPhone(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="pr-fee"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Costo de consulta (MXN)
              </label>
              <input
                id="pr-fee"
                type="number"
                step="0.01"
                min="0"
                value={prFee}
                onChange={(e) => setPrFee(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="pr-addr"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Direccion del consultorio
            </label>
            <input
              id="pr-addr"
              type="text"
              value={prAddress}
              onChange={(e) => setPrAddress(e.target.value)}
              className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
            />
          </div>

          <div>
            <label
              htmlFor="pr-notes"
              className="block text-[13px] font-semibold text-[#0F172A] mb-1"
            >
              Notas
            </label>
            <textarea
              id="pr-notes"
              rows={2}
              value={prNotes}
              onChange={(e) => setPrNotes(e.target.value)}
              className="w-full rounded-[6px] border border-[#CBD5E1] p-3 text-[14px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setProviderOpen(false)}
              className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingProvider}
              className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold"
            >
              {savingProvider ? "Guardando..." : "Guardar Especialista"}
            </button>
          </div>
        </form>
      </ClinicalModal>

      {/* Modal: Cuentas de Acceso (Solo Admin) */}
      {isAdmin && (
        <ClinicalModal
          open={Boolean(editingUser)}
          onClose={() => !savingUser && setEditingUser(null)}
          title={`Credenciales de Acceso: ${editingUser?.display_name ?? ""}`}
          subtitle="Actualiza el nombre de usuario o asigna una nueva contrasena."
          maxWidthClass="max-w-md"
        >
          <form onSubmit={handleAuthUserSubmit} className="space-y-4">
            {userError && (
              <div
                role="alert"
                className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px]"
              >
                {userError}
              </div>
            )}

            <div>
              <label
                htmlFor="au-user"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Usuario de acceso *
              </label>
              <input
                id="au-user"
                type="text"
                required
                value={uUsername}
                onChange={(e) => setUUsername(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="au-display"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Nombre visible *
              </label>
              <input
                id="au-display"
                type="text"
                required
                value={uDisplayName}
                onChange={(e) => setUDisplayName(e.target.value)}
                className="clinical-input w-full border border-[#CBD5E1] px-3 text-[14px]"
              />
            </div>

            <div>
              <label
                htmlFor="au-pass"
                className="block text-[13px] font-semibold text-[#0F172A] mb-1"
              >
                Nueva contrasena (dejar en blanco para conservar la actual)
              </label>
              <input
                id="au-pass"
                type="password"
                value={uPassword}
                onChange={(e) => setUPassword(e.target.value)}
                placeholder="Minimo 6 caracteres"
                className="clinical-input w-full border border-[#CBD5E1] px-3 font-mono text-[14px]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="clinical-btn px-4 border border-[#CBD5E1] bg-white text-[#334155] text-[14px]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingUser}
                className="clinical-btn px-5 bg-[#0E7490] hover:bg-[#155E75] text-white text-[14px] font-semibold"
              >
                {savingUser ? "Guardando..." : "Actualizar Credenciales"}
              </button>
            </div>
          </form>
        </ClinicalModal>
      )}

      {/* Modal: Historial de Versiones de Medicamento (Solo Admin) */}
      {isAdmin && (
        <MedicationVersionsModal
          medication={versionsTarget}
          versions={snapshot.medication_versions}
          onClose={() => setVersionsTarget(null)}
          onRestoreVersion={onRestoreVersion}
          onMarkReviewed={onMarkVersionReviewed}
        />
      )}
    </div>
  );
}
