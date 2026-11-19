import { NextResponse } from "next/server";
import { z } from "zod";
import { PatientDossierService } from "@/lib/services/patient-dossier.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const providerFields = {
  name: z.string().min(1).max(150),
  specialty: z.string().min(1).max(120),
  clinic_or_center: z.string().max(180).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  consultation_fee: z.number().min(0).nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
};

const dossierActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_profile"),
    full_name: z.string().min(1).max(150),
    birth_date: z.string().nullable().optional(),
    blood_type: z.string().max(10).nullable().optional(),
    weight_kg: z.number().positive().nullable().optional(),
    height_cm: z.number().positive().nullable().optional(),
    allergies: z.string().nullable().optional(),
    chronic_conditions: z.string().nullable().optional(),
    insurance_provider: z.string().max(150).nullable().optional(),
    insurance_policy: z.string().max(120).nullable().optional(),
    emergency_contact_name: z.string().max(150).nullable().optional(),
    emergency_contact_phone: z.string().max(60).nullable().optional(),
    emergency_contact_relation: z.string().max(80).nullable().optional(),
    general_notes: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("create_provider"),
    ...providerFields,
  }),
  z.object({
    action: z.literal("update_provider"),
    provider_id: z.string().uuid(),
    ...providerFields,
  }),
  z.object({
    action: z.literal("delete_provider"),
    provider_id: z.string().uuid(),
  }),
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = dossierActionSchema.parse(raw);

    if (body.action === "update_profile") {
      const profile = await PatientDossierService.updatePatientProfile(body);
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, profile },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "create_provider") {
      const provider = await PatientDossierService.createCareProvider(body);
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, provider },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "update_provider") {
      const provider = await PatientDossierService.updateCareProvider(
        body.provider_id,
        body
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, provider },
        { headers: NO_STORE_HEADERS }
      );
    }

    const result = await PatientDossierService.deleteCareProvider(
      body.provider_id
    );
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error en expediente clinico.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
