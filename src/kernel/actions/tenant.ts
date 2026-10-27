import { createMiddleware } from "next-safe-action";
import type pino from "pino";
import { ActionError } from "@/kernel/actions/errors";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { isKnownOrgRole, roleFromMembership } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { logger } from "@/kernel/logging/logger";

export type OnCommit = (cb: () => Promise<void>) => void;

/**
 * Tenant middleware for next-safe-action.
 * Validates user has access to the active tenant, builds CallerIdentity,
 * and wraps the handler inside withTenantTransaction so RLS is always active.
 *
 * Post-commit callbacks: Actions register side-effect callbacks via ctx.onCommit().
 * These execute sequentially AFTER the DB transaction commits successfully.
 * If the transaction rolls back, callbacks are never executed.
 * If a callback fails, it is logged at warn level but does not throw.
 */
export const tenantMiddleware = createMiddleware<{
  serverError: AppError;
  ctx: { userId: string; tenantId: string | null; log: pino.Logger };
}>().define(async ({ ctx, next }) => {
  const { userId, tenantId } = ctx;

  if (!tenantId) {
    throw new ActionError({
      code: "UNAUTHORIZED",
      message: "No active tenant in session",
      retryable: false,
    });
  }

  // Look up member role using BASE Prisma client (auth tables have no RLS)
  const member = await prisma.member.findFirst({
    where: { userId, organizationId: tenantId },
  });

  if (!member) {
    throw new ActionError({
      code: "FORBIDDEN",
      message: "User is not a member of the active tenant",
      retryable: false,
    });
  }

  if (!isKnownOrgRole(member.role)) {
    ctx.log.warn({ role: member.role, userId }, "Unknown Better Auth role");
    throw new ActionError({
      code: "FORBIDDEN",
      message: `Unknown role: ${member.role}`,
      retryable: false,
    });
  }
  const role: CallerIdentity["role"] = roleFromMembership(member.role);

  const callerIdentity: CallerIdentity = Object.freeze({
    userId,
    tenantId,
    role,
    source: "web" as const,
  });

  // Per-request scoped — each request gets its own array (concurrent isolation)
  const postCommitCallbacks: Array<() => Promise<void>> = [];
  const onCommit: OnCommit = (cb) => {
    postCommitCallbacks.push(cb);
  };

  // Middleware-managed transaction — handler runs inside RLS-scoped tx.
  // F111 (audit D12): a handler that RETURNS an error after a write used to commit the write — atomicity by
  // convention (`throw new RollbackError` at 19 sites). Now the middleware rolls back whenever the result
  // carries an error, and hands the same result back, so the client sees exactly what it saw before.
  let rolledBack = false;
  const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
    const r = await next({ ctx: { callerIdentity, tx, onCommit } });
    if (returnedError(r)) throw new RolledBack(r);
    return r;
  }).catch((error: unknown) => {
    if (!(error instanceof RolledBack)) throw error;
    rolledBack = true;
    // the handler's own answer, typed as the transaction's result it is (the throw carried it out unchanged)
    return error.result as never;
  });
  // rolled back: nothing was written, no side effect runs — the handler's answer goes to the client
  if (rolledBack) return result;

  // Transaction committed — run side effects sequentially
  for (const cb of postCommitCallbacks) {
    try {
      await cb();
    } catch (err) {
      logger.warn({ err }, "Post-commit callback failed");
    }
  }

  return result;
});

/** The handler's result is a `ServiceResult` with an error (`{ data: { error } }`), or next-safe-action's own failure. */
export function returnedError(result: { success?: boolean; data?: unknown } | undefined): boolean {
  if (!result) return false;
  if (result.success === false) return true;
  const data = result.data;
  return (
    !!data &&
    typeof data === "object" &&
    "error" in data &&
    (data as { error?: unknown }).error != null
  );
}

/** Thrown inside the transaction to roll it back while keeping the handler's result for the client. */
class RolledBack extends Error {
  constructor(public readonly result: unknown) {
    super("rolled back: the handler returned an error");
    this.name = "RolledBack";
  }
}
