import { PrismaClientKnownRequestError } from "@prisma/client-runtime-utils";
import { createMiddleware, createSafeActionClient } from "next-safe-action";
import type { TransactionClient } from "@/server/db/tenant-client";
import { createAuditEntry } from "@/server/services/audit";
import type { AppError } from "@/types/app-error";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";
import { authMiddleware } from "./auth";
import { ActionError } from "./errors";
import { checkRateLimit, resetRateLimit } from "./rate-limit";
import { tenantMiddleware } from "./tenant";

/**
 * Base action client with error handler.
 * handleServerError distinguishes ActionError (business errors from middleware)
 * from unexpected crashes. Both are returned as serverError to the client.
 *
 * - ActionError → pass through the AppError object
 * - Prisma errors → INTERNAL_ERROR with retryable: true
 * - Other errors → INTERNAL_ERROR with retryable: false
 */
const baseClient = createSafeActionClient({
  handleServerError: (error) => {
    if (error instanceof ActionError) {
      return error.appError;
    }
    console.error("Server Action error:", error);
    const retryable = error instanceof PrismaClientKnownRequestError;
    return {
      code: "INTERNAL_ERROR" as const,
      message: "An unexpected error occurred",
      retryable,
    };
  },
});

/**
 * Public actions (login, register) — no auth, no middleware.
 * MUST NEVER perform database mutations.
 */
export const publicAction = baseClient;

/**
 * Rate limit middleware — enforces in-memory rate limiting per userId.
 * Runs BEFORE tenant middleware to avoid holding open a DB transaction
 * for rejected requests.
 */
const rateLimitMiddleware = createMiddleware<{
  serverError: AppError;
  ctx: { userId: string };
}>().define(async ({ ctx, next }) => {
  const { allowed } = checkRateLimit(ctx.userId);
  if (!allowed) {
    throw new ActionError({
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryable: true,
    });
  }
  return next({ ctx });
});

/**
 * Audit context middleware — provides opt-in audit.log() function.
 * Services call audit.log() explicitly for mutations.
 * Seed source gets a no-op logger (no audit for seed operations).
 */
const auditMiddleware = createMiddleware<{
  serverError: AppError;
  ctx: { callerIdentity: CallerIdentity; tx: TransactionClient };
}>().define(async ({ ctx, next }) => {
  const isNoOp = ctx.callerIdentity.source === "seed";
  const audit: AuditLogger = {
    log: async (params) => {
      if (isNoOp) return;
      await createAuditEntry(ctx.tx, ctx.callerIdentity, params);
    },
  };
  return next({ ctx: { ...ctx, audit } });
});

/**
 * Authenticated actions — for CROSS-ROLE READ operations only.
 * Chain order: auth → rateLimit → tenant → audit
 * Rate limiting runs BEFORE tenant to avoid holding a DB transaction for rejected requests.
 */
export const authedAction = baseClient
  .use(authMiddleware)
  .use(rateLimitMiddleware)
  .use(tenantMiddleware)
  .use(auditMiddleware);

/**
 * requireRole middleware — checks callerIdentity.role from context.
 */
const ownerRoleMiddleware = createMiddleware<{
  serverError: AppError;
  ctx: { callerIdentity: { role: string } };
}>().define(async ({ ctx, next }) => {
  if (ctx.callerIdentity.role !== "owner") {
    throw new ActionError({
      code: "FORBIDDEN",
      message: "Requires owner role",
      retryable: false,
    });
  }
  return next({ ctx });
});

/**
 * Owner-only actions — for ALL mutations and owner-restricted reads.
 * Extends authedAction with owner role check.
 */
export const ownerAction = authedAction.use(ownerRoleMiddleware);

// Re-export for test cleanup
export { resetRateLimit };
export { ActionError } from "./errors";
