import type { PrismaClient } from "@/generated/prisma/client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";

// MUST NOT import from next/* or src/components/*

/**
 * Dashboard data fetching service.
 *
 * DUAL PRISMA CLIENT (INTENTIONAL EXCEPTION):
 * This service needs two data access paths:
 * - `prisma` (base client): For auth tables (`user`, `session`) which have no
 *   `tenant_id` column and live outside RLS.
 * - `tx` (tenant-scoped): For tenant data (`tenant` table, company name) which
 *   requires RLS scoping via SET LOCAL.
 *
 * This dual-client pattern is required because Better Auth's tables don't have
 * tenant_id. It is NOT a violation of the hexagonal architecture — both clients
 * are injected as parameters, keeping the service framework-agnostic.
 */

export type DashboardData = {
  userName: string;
  companyName: string | null;
  lastLoginAt: string | null;
  role: string;
};

/**
 * The page header. The `tx` read is not caught: the page runs every read in one interactive transaction, and a
 * failed statement aborts it — swallowing the error here would hide the first cause behind the next read's
 * "current transaction is aborted". The base-client reads (`user`, `session`) run outside that transaction and
 * keep their fallback.
 */
export async function getDashboardData(
  prisma: PrismaClient,
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<DashboardData> {
  // Fetch user name from auth table (no RLS)
  const user = await prisma.user.findUnique({
    where: { id: caller.userId },
    select: { name: true },
  });

  // Company name from the tenant row (RLS-scoped) — throws with the transaction
  const tenant = await tx.tenant.findUnique({
    where: { id: caller.tenantId },
    select: { name: true },
  });

  // Last login: second most recent session (skip current session)
  let lastLoginAt: string | null = null;
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: caller.userId },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { createdAt: true },
    });
    if (sessions.length >= 2) {
      lastLoginAt = sessions[1].createdAt.toISOString();
    }
  } catch {
    // Graceful degradation — hide last login field (base client, outside the tenant transaction)
  }

  return {
    userName: user?.name ?? "User",
    companyName: tenant?.name ?? null,
    lastLoginAt,
    role: caller.role,
  };
}
