import * as Sentry from "@sentry/nextjs";
import { createMiddleware } from "next-safe-action";
import type pino from "pino";
import { logger } from "@/server/logger";
import type { AppError } from "@/types/app-error";

export const loggingMiddleware = createMiddleware<{
  serverError: AppError;
  ctx: { userId: string; tenantId: string | null };
}>().define(async ({ ctx, next }) => {
  const requestId = crypto.randomUUID();
  Sentry.setTag("requestId", requestId);

  const log: pino.Logger = logger.child({
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    requestId,
  });

  log.info({ action: "server_action" }, "Action invoked");

  const start = performance.now();
  try {
    return await next({ ctx: { ...ctx, log } });
  } finally {
    const durationMs = Math.round(performance.now() - start);
    log.info({ action: "server_action", durationMs }, "Action completed");
  }
});
