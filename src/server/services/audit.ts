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
      // biome-ignore lint/suspicious/noExplicitAny: Prisma's InputJsonValue is too narrow for Record<string, unknown>
      oldData: params.oldData as any,
      // biome-ignore lint/suspicious/noExplicitAny: Prisma's InputJsonValue is too narrow for Record<string, unknown>
      newData: params.newData as any,
    },
  });
}

/**
 * Strips Prisma internals from a record for audit log storage.
 * Returns only plain data fields — no relations, no _count, no Prisma metadata.
 *
 * WARNING: Do not pass records containing sensitive fields (password hashes, API keys).
 * Use explicit field picking if the model has sensitive data.
 */
export function toAuditData(record: unknown): Record<string, unknown> | null {
  if (!record) return null;
  const { id, ...fields } = record as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([_, v]) => v === null || typeof v !== "object" || v instanceof Date,
    ),
  );
}

/**
 * Retrieves audit log entries for a tenant, filtered by entity.
 * Future use — will power audit trail UI in later stories.
 * Not yet tested — tests will be added when the audit trail UI is implemented.
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
