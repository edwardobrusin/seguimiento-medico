import { query, type DbExecutor } from "@/lib/db/client";
import type { GovernanceAuditLog } from "@/lib/types/clinical";

export interface LogAuditInput {
  entity_type: string;
  entity_id: string;
  entity_label: string;
  action: string;
  actor?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

type QueryExecutor = Pick<DbExecutor, "query">;

export class GovernanceAuditService {
  static async log(
    input: LogAuditInput,
    executor: QueryExecutor = { query }
  ): Promise<GovernanceAuditLog | null> {
    try {
      const res = await executor.query<GovernanceAuditLog>(
        `INSERT INTO governance_audit_logs (
           entity_type, entity_id, entity_label, action, actor, summary, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING *`,
        [
          input.entity_type,
          input.entity_id,
          input.entity_label.slice(0, 200),
          input.action,
          (input.actor ?? "Consola Clinica Web").slice(0, 100),
          input.summary,
          JSON.stringify(input.metadata ?? {}),
        ]
      );
      return res.rows[0] ?? null;
    } catch {
      // No interrumpir transaccion clinica principal si falla auditoria secundaria
      return null;
    }
  }
}
