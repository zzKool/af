import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { createMiddleware } from "next-safe-action";
import { ActionError } from "@/kernel/actions/errors";
import { getAuthContext } from "@/kernel/auth/auth";
import type { AppError } from "@/kernel/errors/app-error";

/**
 * Auth middleware for next-safe-action.
 * Extracts userId and tenantId from session via getAuthContext.
 * Called exactly ONCE — all downstream middleware reads from context.
 */
export const authMiddleware = createMiddleware<{
  serverError: AppError;
}>().define(async ({ next }) => {
  const hdrs = await headers();
  const authCtx = await getAuthContext(hdrs);

  if (!authCtx) {
    throw new ActionError({
      code: "UNAUTHORIZED",
      message: "No active session",
      retryable: false,
    });
  }

  Sentry.setUser({ id: authCtx.userId });
  Sentry.setContext("tenant", { tenantId: authCtx.tenantId });

  return next({
    ctx: {
      userId: authCtx.userId,
      tenantId: authCtx.tenantId,
    },
  });
});
