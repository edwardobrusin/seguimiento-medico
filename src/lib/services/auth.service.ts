import { query, withTransaction } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { AuthUserPublic, UserRole } from "@/lib/types/clinical";
import { GovernanceAuditService } from "./governance-audit.service";

interface AuthUserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
  is_active: boolean;
  updated_at: string;
}

export class AuthService {
  static async authenticateUser(
    username: string,
    password: string
  ): Promise<{
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
  } | null> {
    const cleanUser = username.trim();
    if (!cleanUser || !password) return null;

    const res = await query<AuthUserRow>(
      `SELECT id, username, display_name, role, password_hash, is_active, updated_at::text
       FROM auth_users
       WHERE LOWER(username) = LOWER($1)
         AND is_active = TRUE
       LIMIT 1`,
      [cleanUser]
    );
    const user = res.rows[0];
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash)) return null;

    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    };
  }

  static async listAuthUsers(): Promise<AuthUserPublic[]> {
    const res = await query<AuthUserPublic>(
      `SELECT id, username, display_name, role, is_active, updated_at
       FROM auth_users
       ORDER BY CASE WHEN role = 'ADMIN' THEN 0 ELSE 1 END, username ASC`
    );
    return res.rows;
  }

  static async updateAuthUser(
    userId: string,
    updates: {
      username?: string;
      display_name?: string;
      new_password?: string;
    },
    actor = "Admin Web"
  ): Promise<AuthUserPublic> {
    return withTransaction(async (tx) => {
      const prevRes = await tx.query<AuthUserRow>(
        `SELECT * FROM auth_users WHERE id = $1::uuid LIMIT 1`,
        [userId]
      );
      const prev = prevRes.rows[0];
      if (!prev) {
        throw new Error("Cuenta de acceso no encontrada.");
      }

      const nextUsername = updates.username?.trim() || prev.username;
      const nextDisplayName = updates.display_name?.trim() || prev.display_name;
      const nextHash =
        updates.new_password && updates.new_password.length > 0
          ? hashPassword(updates.new_password)
          : prev.password_hash;

      if (nextUsername.length < 3) {
        throw new Error("El nombre de usuario debe tener al menos 3 caracteres.");
      }
      if (updates.new_password && updates.new_password.length < 6) {
        throw new Error("La nueva contrasena debe tener al menos 6 caracteres.");
      }

      const conflictRes = await tx.query<{ id: string }>(
        `SELECT id FROM auth_users
         WHERE LOWER(username) = LOWER($1) AND id != $2::uuid LIMIT 1`,
        [nextUsername, userId]
      );
      if (conflictRes.rows.length > 0) {
        throw new Error(`El usuario "${nextUsername}" ya esta en uso.`);
      }

      const res = await tx.query<AuthUserPublic>(
        `UPDATE auth_users
         SET username = $2,
             display_name = $3,
             password_hash = $4,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING id, username, display_name, role, is_active, updated_at`,
        [userId, nextUsername, nextDisplayName, nextHash]
      );

      const updated = res.rows[0];
      await GovernanceAuditService.log(
        {
          entity_type: "AUTH_USER",
          entity_id: updated.id,
          entity_label: `${updated.username} (${updated.role})`,
          action: "UPDATE",
          actor,
          summary: `Credenciales actualizadas para "${updated.display_name}" (${updated.username})${
            updates.new_password ? " incluyendo cambio de contrasena." : "."
          }`,
        },
        tx
      );

      return updated;
    });
  }
}
