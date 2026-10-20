import * as Sentry from "@sentry/nextjs";
import { createMiddleware } from "next-safe-action";
import type pino from "pino";
import type { AppError } from "@/kernel/errors/app-error";
import { logger } from "@/kernel/logging/logger";

export const loggingMiddleware = createMiddleware<{
  serverError: AppError;
  ctx: { userId: string; tenantId: string | null };
  metadata: { name: string };
}>().define(async ({ ctx, metadata, next }) => {
  const requestId = crypto.randomUUID();
  const actionName = metadata?.name ?? "unknown";
  Sentry.setTag("requestId", requestId);

  const log: pino.Logger = logger.child({
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    requestId,
  });

  log.info({ action: actionName }, "Action invoked");

  const start = performance.now();
  try {
    return await next({ ctx: { ...ctx, log } });
  } finally {
    const durationMs = Math.round(performance.now() - start);
    log.info({ action: actionName, durationMs }, "Action completed");
  }
});
