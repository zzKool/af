import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";

/**
 * Build a CallerIdentity for system-initiated async jobs.
 * userId should be the ORIGINAL user who triggered the action
 * (e.g., the user who uploaded the document), passed via event data.
 */
export function createSystemCaller(tenantId: string, userId: string): CallerIdentity {
  return { userId, tenantId, role: "owner", source: "system" };
}

/**
 * Execute a callback within full Inngest context: RLS transaction + audit logger.
 *
 * Mirrors the auditMiddleware pattern from action-client.ts but for Inngest
 * functions which run outside the Server Action middleware chain.
 */
export async function withInngestContext<T>(
  tenantId: string,
  userId: string,
  callback: (tx: TransactionClient, caller: CallerIdentity, audit: AuditLogger) => Promise<T>,
): Promise<T> {
  const caller = createSystemCaller(tenantId, userId);
  return withTenantTransaction(prisma, tenantId, async (tx) => {
    const audit: AuditLogger = {
      log: async (params) => createAuditEntry(tx, caller, params),
    };
    return callback(tx, caller, audit);
  });
}
