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
