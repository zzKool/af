import { headers } from "next/headers";
import { createMiddleware } from "next-safe-action";
import { getAuthContext } from "@/server/auth";
import type { AppError } from "@/types/app-error";
import { ActionError } from "./errors";

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

  return next({
    ctx: {
      userId: authCtx.userId,
      tenantId: authCtx.tenantId,
    },
  });
});
