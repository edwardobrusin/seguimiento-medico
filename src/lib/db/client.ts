import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";

export type QueryResultRow = Record<string, unknown>;

export interface DbQueryResult<T = QueryResultRow> {
  rows: T[];
  rowCount: number;
}

export interface DbExecutor {
  query<T = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<DbQueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export type DbMode = "NEON_POOL" | "LOCAL_POSTGRES";

declare global {
  var __clinicalNeonPool: Pool | undefined;
  var __clinicalPglite: PGlite | undefined;
  var __clinicalDbInitPromise: Promise<void> | undefined;
}

function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
    return null;
  }
  return url;
}

export function getDbMode(): DbMode {
  return getDatabaseUrl() ? "NEON_POOL" : "LOCAL_POSTGRES";
}

function getNeonPool(): Pool {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL no configurado para Neon Pool.");
  }
  if (!globalThis.__clinicalNeonPool) {
    globalThis.__clinicalNeonPool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return globalThis.__clinicalNeonPool;
}

function getPgliteInstance(): PGlite {
  if (!globalThis.__clinicalPglite) {
    const customDir = process.env.CLINICAL_PGDATA_DIR?.trim();
    const dataDir = customDir
      ? customDir
      : path.resolve(process.cwd(), ".pgdata", "clinical-care-db");
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    globalThis.__clinicalPglite = new PGlite(dataDir);
  }
  return globalThis.__clinicalPglite;
}

function wrapPoolClient(client: PoolClient | Pool): DbExecutor {
  return {
    async query<T = QueryResultRow>(
      sql: string,
      params?: unknown[]
    ): Promise<DbQueryResult<T>> {
      const result = await client.query<QueryResultRow>(sql, params);
      return {
        rows: result.rows as unknown as T[],
        rowCount: result.rowCount ?? result.rows.length,
      };
    },
    async exec(sql: string): Promise<void> {
      await client.query(sql);
    },
  };
}

function wrapPglite(
  instance: Pick<PGlite, "query" | "exec">
): DbExecutor {
  return {
    async query<T = QueryResultRow>(
      sql: string,
      params?: unknown[]
    ): Promise<DbQueryResult<T>> {
      const result = await instance.query<T>(sql, params);
      return {
        rows: result.rows,
        rowCount: result.affectedRows ?? result.rows.length,
      };
    },
    async exec(sql: string): Promise<void> {
      await instance.exec(sql);
    },
  };
}

export async function getRawExecutor(): Promise<DbExecutor> {
  if (getDbMode() === "NEON_POOL") {
    return wrapPoolClient(getNeonPool());
  }
  const pglite = getPgliteInstance();
  await pglite.waitReady;
  return wrapPglite(pglite);
}

export async function runSchemaAndTriggers(executor: DbExecutor): Promise<void> {
  const dbDir = path.resolve(process.cwd(), "src", "lib", "db");
  const schemaSql = fs.readFileSync(path.join(dbDir, "schema.sql"), "utf8");
  const triggersSql = fs.readFileSync(path.join(dbDir, "triggers.sql"), "utf8");

  await executor.exec(schemaSql);
  await executor.exec(triggersSql);
}

export async function ensureInitialized(): Promise<void> {
  if (!globalThis.__clinicalDbInitPromise) {
    globalThis.__clinicalDbInitPromise = (async () => {
      const executor = await getRawExecutor();
      await runSchemaAndTriggers(executor);
      const { seedClinicalDatabaseIfEmpty } = await import("./seed");
      await seedClinicalDatabaseIfEmpty(executor);
      const { ensureDefaultAuthUsers } = await import("../auth/seed-users");
      await ensureDefaultAuthUsers(executor);
    })().catch((err) => {
      globalThis.__clinicalDbInitPromise = undefined;
      throw err;
    });
  }
  await globalThis.__clinicalDbInitPromise;
}

export async function query<T = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<DbQueryResult<T>> {
  await ensureInitialized();
  const executor = await getRawExecutor();
  return executor.query<T>(sql, params);
}

export async function withTransaction<T>(
  fn: (tx: DbExecutor) => Promise<T>
): Promise<T> {
  await ensureInitialized();
  if (getDbMode() === "NEON_POOL") {
    const pool = getNeonPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(wrapPoolClient(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else {
    const pglite = getPgliteInstance();
    await pglite.waitReady;
    return pglite.transaction(async (tx) => {
      return fn({
        async query<R = QueryResultRow>(
          sql: string,
          params?: unknown[]
        ): Promise<DbQueryResult<R>> {
          const res = await tx.query<R>(sql, params);
          return {
            rows: res.rows,
            rowCount: res.affectedRows ?? res.rows.length,
          };
        },
        async exec(sql: string): Promise<void> {
          await tx.exec(sql);
        },
      });
    });
  }
}

export async function closeDbForTests(): Promise<void> {
  if (globalThis.__clinicalNeonPool) {
    await globalThis.__clinicalNeonPool.end();
    globalThis.__clinicalNeonPool = undefined;
  }
  if (globalThis.__clinicalPglite) {
    await globalThis.__clinicalPglite.close();
    globalThis.__clinicalPglite = undefined;
  }
  globalThis.__clinicalDbInitPromise = undefined;
}
