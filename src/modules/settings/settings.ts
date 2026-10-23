import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

export type TenantProfile = {
  name: string;
  orgNumber: string | null;
  address: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  logoUrl: string | null;
  currency: string;
};

export type UpdateTenantProfileInput = {
  name?: string;
  orgNumber?: string | null;
  address?: string | null;
  email?: string | null;
  website?: string | null;
  phone?: string | null;
  currency?: string;
};

export async function getTenantProfile(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<ServiceResult<TenantProfile>> {
  const tenant = await tx.tenant.findUnique({ where: { id: caller.tenantId } });
  if (!tenant) {
    return { error: { code: "NOT_FOUND", message: "Tenant not found", retryable: false } };
  }
  return { data: toProfile(tenant) };
}

function toProfile(t: {
  name: string;
  orgNumber: string | null;
  address: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  logoUrl: string | null;
  currency: string;
}): TenantProfile {
  return {
    name: t.name,
    orgNumber: t.orgNumber,
    address: t.address,
    email: t.email,
    website: t.website,
    phone: t.phone,
    logoUrl: t.logoUrl,
    currency: t.currency,
  };
}

export async function updateTenantProfile(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: UpdateTenantProfileInput,
): Promise<ServiceResult<TenantProfile>> {
  // Read-before-write for audit oldData. Under READ COMMITTED (PostgreSQL default),
  // concurrent updates to the same tenant could cause stale oldData in the audit log.
  // Acceptable for a solo-owner app; revisit with SERIALIZABLE if multi-user editing is added.
  const old = await tx.tenant.findUnique({ where: { id: caller.tenantId } });
  if (!old) {
    return { error: { code: "NOT_FOUND", message: "Tenant not found", retryable: false } };
  }

  const tenant = await tx.tenant.update({
    where: { id: caller.tenantId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.orgNumber !== undefined && { orgNumber: input.orgNumber }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.website !== undefined && { website: input.website }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.currency !== undefined && { currency: input.currency }),
    },
  });

  await audit.log({
    action: "update",
    entityType: "tenant",
    entityId: caller.tenantId,
    oldData: toAuditData(old),
    newData: toAuditData(tenant),
  });

  // Sync name to Organization model to prevent Org ↔ Tenant name desync.
  // Uses the same transaction so both updates are atomic — if either fails, both roll back.
  // Organization table has no RLS, so SET LOCAL doesn't affect this query.
  if (input.name !== undefined) {
    await tx.organization.update({
      where: { id: caller.tenantId },
      data: { name: input.name },
    });
  }

  return { data: toProfile(tenant) };
}

export async function listTenantMembers(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<ServiceResult<{ id: string; userId: string; role: string }[]>> {
  // Member table has no RLS — querying through the RLS-scoped tx is safe
  // because SET LOCAL only affects tables with RLS policies.
  const members = await tx.member.findMany({
    where: { organizationId: caller.tenantId },
    select: { id: true, userId: true, role: true },
  });
  return { data: members };
}
