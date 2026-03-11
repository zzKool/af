import type { TransactionClient } from "@/server/db/tenant-client";
import type { CallerIdentity } from "@/types/caller-identity";

// MUST NOT import from next/* or src/components/*

/**
 * Creates an audit log entry within the current transaction.
 * Called by services explicitly after mutations — not automatic middleware.
 */
export async function createAuditEntry(
  tx: TransactionClient,
  caller: CallerIdentity,
  params: {
    action: "create" | "update" | "delete";
    entityType: string;
    entityId: string;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: caller.tenantId,
      userId: caller.userId,
      source: caller.source,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      oldData: params.oldData ?? undefined,
      newData: params.newData ?? undefined,
    },
  });
}

/**
 * Retrieves audit log entries for a tenant, filtered by entity.
 * Future use — will power audit trail UI in later stories.
 */
export async function getAuditLog(
  tx: TransactionClient,
  params: {
    entityType?: string;
    entityId?: string;
    limit?: number;
  },
): Promise<
  {
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    userId: string;
    source: string;
    oldData: unknown;
    newData: unknown;
    createdAt: Date;
  }[]
> {
  return tx.auditLog.findMany({
    where: {
      ...(params.entityType && { entityType: params.entityType }),
      ...(params.entityId && { entityId: params.entityId }),
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
  });
}
