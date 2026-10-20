import { createMiddleware } from "next-safe-action";
import type pino from "pino";
import { ActionError } from "@/kernel/actions/errors";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
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

  // Defensive exhaustive role match
  let role: CallerIdentity["role"];
  switch (member.role) {
    case "owner":
      role = "owner";
      break;
    case "member":
      role = "accountant";
      break;
    default:
      ctx.log.warn({ role: member.role, userId }, "Unknown Better Auth role");
      throw new ActionError({
        code: "FORBIDDEN",
        message: `Unknown role: ${member.role}`,
        retryable: false,
      });
  }

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

  // Middleware-managed transaction — handler runs inside RLS-scoped tx
  const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
    return next({ ctx: { callerIdentity, tx, onCommit } });
  });

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
