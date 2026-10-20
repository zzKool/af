import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Base Prisma client singleton.
 *
 * IMPORTANT: Do NOT use `prisma` directly for tenant-scoped queries.
 * Always use `withTenantTransaction()` from `tenant-client.ts` instead.
 * Direct usage bypasses RLS tenant isolation.
 *
 * This export exists for passing into `withTenantTransaction(prisma, ...)`.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { pool };
