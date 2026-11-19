import { withTransaction } from "@/lib/db/client";
import type { CareProvider, PatientProfile } from "@/lib/types/clinical";
import { GovernanceAuditService } from "./governance-audit.service";

export interface UpdatePatientProfileInput {
  full_name: string;
  birth_date?: string | null;
  blood_type?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  allergies?: string | null;
  chronic_conditions?: string | null;
  insurance_provider?: string | null;
  insurance_policy?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
  general_notes?: string | null;
}

export interface CareProviderInput {
  name: string;
  specialty: string;
  clinic_or_center?: string | null;
  city?: string | null;
  phone?: string | null;
  consultation_fee?: number | null;
  address?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export class PatientDossierService {
  static async updatePatientProfile(
    input: UpdatePatientProfileInput,
    actor = "Consola Clinica Web"
  ): Promise<PatientProfile> {
    return withTransaction(async (tx) => {
      const res = await tx.query<PatientProfile>(
        `INSERT INTO patient_profile (
           id, full_name, birth_date, blood_type, weight_kg, height_cm,
           allergies, chronic_conditions, insurance_provider, insurance_policy,
           emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
           general_notes, updated_at
         ) VALUES (
           1, $1, $2::date, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11, $12,
           $13, NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           birth_date = EXCLUDED.birth_date,
           blood_type = EXCLUDED.blood_type,
           weight_kg = EXCLUDED.weight_kg,
           height_cm = EXCLUDED.height_cm,
           allergies = EXCLUDED.allergies,
           chronic_conditions = EXCLUDED.chronic_conditions,
           insurance_provider = EXCLUDED.insurance_provider,
           insurance_policy = EXCLUDED.insurance_policy,
           emergency_contact_name = EXCLUDED.emergency_contact_name,
           emergency_contact_phone = EXCLUDED.emergency_contact_phone,
           emergency_contact_relation = EXCLUDED.emergency_contact_relation,
           general_notes = EXCLUDED.general_notes,
           updated_at = NOW()
         RETURNING
           id,
           full_name,
           birth_date::text AS birth_date,
           blood_type,
           weight_kg::float8 AS weight_kg,
           height_cm::float8 AS height_cm,
           allergies,
           chronic_conditions,
           insurance_provider,
           insurance_policy,
           emergency_contact_name,
           emergency_contact_phone,
           emergency_contact_relation,
           general_notes,
           updated_at`,
        [
          input.full_name.trim(),
          input.birth_date || null,
          input.blood_type?.trim() || null,
          input.weight_kg ?? null,
          input.height_cm ?? null,
          input.allergies?.trim() || null,
          input.chronic_conditions?.trim() || null,
          input.insurance_provider?.trim() || null,
          input.insurance_policy?.trim() || null,
          input.emergency_contact_name?.trim() || null,
          input.emergency_contact_phone?.trim() || null,
          input.emergency_contact_relation?.trim() || null,
          input.general_notes?.trim() || null,
        ]
      );

      const profile = res.rows[0];
      await GovernanceAuditService.log(
        {
          entity_type: "PATIENT_PROFILE",
          entity_id: "1",
          entity_label: profile.full_name,
          action: "PROFILE_UPDATE",
          actor,
          summary: `Ficha clinica del paciente "${profile.full_name}" actualizada.`,
        },
        tx
      );
      return profile;
    });
  }

  static async createCareProvider(
    input: CareProviderInput,
    actor = "Consola Clinica Web"
  ): Promise<CareProvider> {
    return withTransaction(async (tx) => {
      const res = await tx.query<CareProvider>(
        `INSERT INTO care_providers (
           name, specialty, clinic_or_center, city, phone,
           consultation_fee, address, notes, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING
           id, name, specialty, clinic_or_center, city, phone,
           consultation_fee::float8 AS consultation_fee,
           address, notes, is_active, created_at, updated_at`,
        [
          input.name.trim(),
          input.specialty.trim(),
          input.clinic_or_center?.trim() || null,
          input.city?.trim() || null,
          input.phone?.trim() || null,
          input.consultation_fee ?? null,
          input.address?.trim() || null,
          input.notes?.trim() || null,
          input.is_active ?? true,
        ]
      );

      const provider = res.rows[0];
      await GovernanceAuditService.log(
        {
          entity_type: "CARE_PROVIDER",
          entity_id: provider.id,
          entity_label: provider.name,
          action: "CREATE",
          actor,
          summary: `Especialista/centro "${provider.name}" (${provider.specialty}) agregado al directorio.`,
        },
        tx
      );
      return provider;
    });
  }

  static async updateCareProvider(
    providerId: string,
    input: CareProviderInput,
    actor = "Consola Clinica Web"
  ): Promise<CareProvider> {
    return withTransaction(async (tx) => {
      const res = await tx.query<CareProvider>(
        `UPDATE care_providers
         SET name = $2,
             specialty = $3,
             clinic_or_center = $4,
             city = $5,
             phone = $6,
             consultation_fee = $7,
             address = $8,
             notes = $9,
             is_active = $10,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING
           id, name, specialty, clinic_or_center, city, phone,
           consultation_fee::float8 AS consultation_fee,
           address, notes, is_active, created_at, updated_at`,
        [
          providerId,
          input.name.trim(),
          input.specialty.trim(),
          input.clinic_or_center?.trim() || null,
          input.city?.trim() || null,
          input.phone?.trim() || null,
          input.consultation_fee ?? null,
          input.address?.trim() || null,
          input.notes?.trim() || null,
          input.is_active ?? true,
        ]
      );

      const provider = res.rows[0];
      if (!provider) {
        throw new Error("Especialista o proveedor no encontrado.");
      }

      await GovernanceAuditService.log(
        {
          entity_type: "CARE_PROVIDER",
          entity_id: provider.id,
          entity_label: provider.name,
          action: "UPDATE",
          actor,
          summary: `Datos de "${provider.name}" (${provider.specialty}) actualizados.`,
        },
        tx
      );
      return provider;
    });
  }

  static async deleteCareProvider(
    providerId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    return withTransaction(async (tx) => {
      const res = await tx.query<{ id: string; name: string }>(
        `DELETE FROM care_providers WHERE id = $1::uuid RETURNING id, name`,
        [providerId]
      );
      const deleted = res.rows[0];
      if (!deleted) {
        throw new Error("Especialista o proveedor no encontrado.");
      }

      await GovernanceAuditService.log(
        {
          entity_type: "CARE_PROVIDER",
          entity_id: deleted.id,
          entity_label: deleted.name,
          action: "DELETE",
          actor,
          summary: `Especialista/proveedor "${deleted.name}" eliminado del directorio.`,
        },
        tx
      );
      return { deletedId: deleted.id };
    });
  }
}
