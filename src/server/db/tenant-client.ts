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
 */
export async function withTenantTransaction<T>(
  prisma: PrismaClient,
  tenantId: string,
  callback: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // SET doesn't support parameterized queries in PostgreSQL.
    // Validate UUID format to prevent SQL injection.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new Error(`Invalid tenant ID format: ${tenantId}`);
    }
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
    return callback(tx);
  });
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

export type { TransactionClient };
