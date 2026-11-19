import type { DbExecutor } from "@/lib/db/client";
import { hashPassword } from "./password";

export async function ensureDefaultAuthUsers(db: DbExecutor): Promise<void> {
  const adminCheck = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM auth_users WHERE role = 'ADMIN'`
  );
  if (Number(adminCheck.rows[0]?.count ?? "0") === 0) {
    const adminUser = process.env.AUTH_ADMIN_USERNAME?.trim() || "admin";
    const adminPass =
      process.env.AUTH_ADMIN_PASSWORD?.trim() || "AdminClinico2026!";
    await db.query(
      `INSERT INTO auth_users (username, display_name, role, password_hash, is_active)
       VALUES ($1, 'Administrador Familiar', 'ADMIN', $2, TRUE)
       ON CONFLICT (username) DO NOTHING`,
      [adminUser, hashPassword(adminPass)]
    );
  }

  const patientCheck = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM auth_users WHERE role = 'PATIENT'`
  );
  if (Number(patientCheck.rows[0]?.count ?? "0") === 0) {
    const patientUser = process.env.AUTH_PATIENT_USERNAME?.trim() || "papa";
    const patientPass = process.env.AUTH_PATIENT_PASSWORD?.trim() || "Salud2026";
    await db.query(
      `INSERT INTO auth_users (username, display_name, role, password_hash, is_active)
       VALUES ($1, 'Paciente (Papa)', 'PATIENT', $2, TRUE)
       ON CONFLICT (username) DO NOTHING`,
      [patientUser, hashPassword(patientPass)]
    );
  }
}
