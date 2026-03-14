import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionClient } from "@/server/db/tenant-client";
import type { CallerIdentity } from "@/types/caller-identity";

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
  partnerCount: number;
  activeContractCount: number;
};

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

  // Fetch company name from tenant table (RLS-scoped)
  let companyName: string | null = null;
  try {
    const tenant = await tx.tenant.findUnique({
      where: { id: caller.tenantId },
      select: { name: true },
    });
    companyName = tenant?.name ?? null;
  } catch {
    // Graceful degradation — show greeting without company name
  }

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
    // Graceful degradation — hide last login field
  }

  // Fetch partner and contract counts (RLS-scoped)
  const [partnerCount, activeContractCount] = await Promise.all([
    tx.partner.count({ where: { isActive: true } }),
    tx.contract.count({ where: { isActive: true } }),
  ]);

  return {
    userName: user?.name ?? "User",
    companyName,
    lastLoginAt,
    role: caller.role,
    partnerCount,
    activeContractCount,
  };
}
