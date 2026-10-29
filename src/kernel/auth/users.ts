// Read API of the auth tables (`users`, `members` — Better Auth's, owned by kernel/auth) for the modules (F66).
// These tables have no RLS: a read through a tenant transaction or the plain client sees the same rows.
import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";

type Db = PrismaClient | TransactionClient;

export type TenantMember = { id: string; userId: string; role: string };

/** A user's display name; null when the user is gone. */
export async function userName(db: Db, userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

/** The members of a tenant (its Better Auth organization), with their role. */
export async function tenantMembers(db: Db, tenantId: string): Promise<TenantMember[]> {
  return db.member.findMany({
    where: { organizationId: tenantId },
    select: { id: true, userId: true, role: true },
  });
}

export type TenantOwner = { tenantId: string; userId: string };

/**
 * One owner per tenant (the oldest membership) — who a scheduled, tenant-wide job runs as (F98's nightly
 * proposals): the audit names him, as it names the uploader of a document for its OCR job.
 */
export async function tenantOwners(db: Db): Promise<TenantOwner[]> {
  const rows = await db.member.findMany({
    where: { role: "owner" },
    select: { organizationId: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  const seen = new Map<string, TenantOwner>();
  for (const r of rows)
    if (!seen.has(r.organizationId))
      seen.set(r.organizationId, { tenantId: r.organizationId, userId: r.userId });
  return [...seen.values()];
}
