import { Prisma } from "@/generated/prisma/client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";

// MUST NOT import from next/* or src/components/*

/**
 * The write mapper of `old_data` / `new_data` (F50-g): a record as the JSON Prisma stores — through a JSON round trip,
 * which is what the column holds anyway (dates as ISO strings, decimals as strings, undefined fields dropped).
 * No data — omitted or an explicit `null` — is one null: SQL NULL (F84; the JSON null is never written).
 */
function auditDataToJson(
  data: Record<string, unknown> | null | undefined,
): Prisma.InputJsonObject | undefined {
  if (data === undefined || data === null) return undefined;
  const json: unknown = JSON.parse(JSON.stringify(data));
  return isJsonObject(json) ? json : {};
}

function isJsonObject(value: unknown): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Creates an audit log entry within the current transaction.
 * Called by services explicitly after mutations — not automatic middleware.
 */
export async function createAuditEntry(
  tx: TransactionClient,
  caller: CallerIdentity,
  params: {
    action: "create" | "update" | "delete" | "deactivate" | "reactivate";
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
      oldData: auditDataToJson(params.oldData),
      newData: auditDataToJson(params.newData),
    },
  });
}

/**
 * Strips Prisma internals from a record for audit log storage.
 * Returns only plain data fields — no relations, no _count, no Prisma metadata.
 * Money is kept: a `Prisma.Decimal` field becomes its decimal string (F84 — its prototype is not `Object`, so the
 * relation filter used to drop it and the trail carried no amount).
 *
 * WARNING: Do not pass records containing sensitive fields (password hashes, API keys).
 * Use explicit field picking if the model has sensitive data.
 */
export function toAuditData(record: unknown): Record<string, unknown> | null {
  if (!record) return null;
  const { id, ...fields } = record as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(fields)
      .map(([k, v]): [string, unknown] => [k, Prisma.Decimal.isDecimal(v) ? v.toString() : v])
      .filter(([_, v]) => {
        if (v === null || typeof v !== "object") return true;
        if (v instanceof Date) return true;
        // Keep arrays (e.g., types: string[], externalIdentifiers: JSONB[])
        if (Array.isArray(v)) return true;
        // Keep plain JSON objects (e.g., address JSONB) — skip Prisma relation objects
        // Prisma relations have a constructor name other than "Object"
        if (Object.getPrototypeOf(v) === Object.prototype) return true;
        return false;
      }),
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

export type AuditActivity = { entityType: string; action: string; count: number };

/**
 * What happened since a moment, grouped by entity type and action — the dashboard's briefing ("since your last
 * visit: 12 bank rows imported, 3 links created …"). Every write is audited, so the trail is the briefing.
 */
export async function activitySince(
  tx: TransactionClient,
  since: Date,
  options: { excludeUserId?: string; limit?: number } = {},
): Promise<AuditActivity[]> {
  const rows = await tx.auditLog.groupBy({
    by: ["entityType", "action"],
    where: {
      createdAt: { gt: since },
      ...(options.excludeUserId ? { userId: { not: options.excludeUserId } } : {}),
    },
    _count: { _all: true },
    orderBy: [{ entityType: "asc" }, { action: "asc" }],
    take: options.limit ?? 50,
  });
  return rows.map((r) => ({ entityType: r.entityType, action: r.action, count: r._count._all }));
}
