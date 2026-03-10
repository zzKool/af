import { createMiddleware } from "next-safe-action";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import type { AppError } from "@/types/app-error";
import type { CallerIdentity } from "@/types/caller-identity";
import { ActionError } from "./errors";

/**
 * Tenant middleware for next-safe-action.
 * Validates user has access to the active tenant, builds CallerIdentity,
 * and wraps the handler inside withTenantTransaction so RLS is always active.
 */
export const tenantMiddleware = createMiddleware<{
  serverError: AppError;
  ctx: { userId: string; tenantId: string | null };
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
      console.warn(`Unknown Better Auth role: ${member.role} for user ${userId}`);
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

  // Option A: middleware-managed transaction — handler runs inside RLS-scoped tx
  return withTenantTransaction(prisma, tenantId, async (tx) => {
    return next({ ctx: { callerIdentity, tx } });
  });
});
