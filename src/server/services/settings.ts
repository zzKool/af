import type { TransactionClient } from "@/server/db/tenant-client";
import type { AppError } from "@/types/app-error";
import type { CallerIdentity } from "@/types/caller-identity";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

export type TenantProfile = {
  name: string;
  orgNumber: string | null;
  address: string | null;
  currency: string;
};

export type UpdateTenantProfileInput = {
  name?: string;
  orgNumber?: string | null;
  address?: string | null;
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
  return {
    data: {
      name: tenant.name,
      orgNumber: tenant.orgNumber,
      address: tenant.address,
      currency: tenant.currency,
    },
  };
}

export async function updateTenantProfile(
  tx: TransactionClient,
  caller: CallerIdentity,
  input: UpdateTenantProfileInput,
): Promise<ServiceResult<TenantProfile>> {
  // Currency immutability guard: reject currency changes if journal entries exist.
  // JournalEntry model doesn't exist yet — TODO: enable this guard when Story 6.3 adds the model.
  // if (input.currency) {
  //   const journalCount = await tx.journalEntry.count({ where: { tenantId: caller.tenantId } });
  //   if (journalCount > 0) {
  //     return { error: { code: "VALIDATION_ERROR", message: "Cannot change currency after journal entries exist", retryable: false } };
  //   }
  // }

  const tenant = await tx.tenant.update({
    where: { id: caller.tenantId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.orgNumber !== undefined && { orgNumber: input.orgNumber }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.currency !== undefined && { currency: input.currency }),
    },
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

  return {
    data: {
      name: tenant.name,
      orgNumber: tenant.orgNumber,
      address: tenant.address,
      currency: tenant.currency,
    },
  };
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
