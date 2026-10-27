import type { Pool } from "pg";
import type { PrismaClient } from "@/generated/prisma/client";

// Prisma's interactive transaction client type (subset of PrismaClient)
type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Executes a callback within a tenant-scoped Prisma interactive transaction.
 *
 * Pattern: Uses Prisma's $transaction (interactive) which holds a single
 * database connection for the duration. SET LOCAL scopes app.tenant_id
 * to this transaction only — safe for connection pooling.
 *
 * This is the primary API for all tenant-scoped database operations:
 * ```
 * const configs = await withTenantTransaction(prisma, tenantId, async (tx) => {
 *   return tx.tenantConfig.findMany();
 * });
 * ```
 *
 * One transaction = one pg client, and a pg client runs one query at a time: the awaits inside the
 * callback go one after the other — never `Promise.all` (or `allSettled` / `any` / `race`) over `tx`.
 * pg queues overlapping queries anyway (no speed is lost) but warns "client.query() while already
 * executing", removed in pg@9 (F53). For a list, `mapInOrder`. The architecture guard enforces it.
 */
/**
 * How long one tenant transaction may run (F111, audit D12). Prisma's default is 5 s — enough for a panel,
 * not for a 3-year CSV import or a package build with its PDFs read back, which run inside one. Named here so
 * every caller takes the same, explicit value; `maxWait` is how long to wait for a connection from the pool.
 */
export const TENANT_TRANSACTION_TIMEOUT_MS = 60_000;
export const TENANT_TRANSACTION_MAX_WAIT_MS = 5_000;

export async function withTenantTransaction<T>(
  prisma: PrismaClient,
  tenantId: string,
  callback: (tx: TransactionClient) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      // SET doesn't support parameterized queries in PostgreSQL.
      // Validate UUID format to prevent SQL injection.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
        throw new Error(`Invalid tenant ID format: ${tenantId}`);
      }
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      return callback(tx);
    },
    {
      timeout: options.timeoutMs ?? TENANT_TRANSACTION_TIMEOUT_MS,
      maxWait: TENANT_TRANSACTION_MAX_WAIT_MS,
    },
  );
}

/**
 * Executes a callback using a raw pg connection with SET LOCAL.
 * Use this when you need direct SQL access outside Prisma's ORM
 * (e.g., for complex queries or admin operations).
 */
export async function withTenantConnection<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const pgClient = await pool.connect();

  try {
    await pgClient.query("BEGIN");
    // SET doesn't support parameterized queries in PostgreSQL.
    // Validate UUID format to prevent SQL injection.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new Error(`Invalid tenant ID format: ${tenantId}`);
    }
    await pgClient.query(`SET LOCAL app.tenant_id = '${tenantId}'`);

    const result = await callback(pgClient);

    await pgClient.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await pgClient.query("ROLLBACK");
    } catch {
      // Swallow rollback error — preserve the original error
    }
    throw error;
  } finally {
    pgClient.release();
  }
}

/**
 * `items.map(fn)` awaited one item at a time, results in order — the `Promise.all(items.map(…))` for a
 * transaction client (see withTenantTransaction: one query at a time on one client).
 */
export async function mapInOrder<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (const [i, item] of items.entries()) out.push(await fn(item, i));
  return out;
}

export type { TransactionClient };
