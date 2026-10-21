import { reportError } from "@/kernel/errors/report-error";
import { logger } from "@/kernel/logging/logger";
import type { JobContext } from "./types";

/**
 * Run one attempt of a job handler. A throw is logged and reported to Sentry with the job's context
 * (queue name, job id, attempt, the tenant when the payload carries one), then rethrown so pg-boss
 * retries — a failed attempt is never swallowed.
 */
export async function runReported<TData extends object>(
  job: string,
  handler: (data: TData, ctx: JobContext) => Promise<void>,
  data: TData,
  ctx: JobContext,
): Promise<void> {
  try {
    await handler(data, ctx);
  } catch (error) {
    const tenantId = (data as { tenantId?: unknown }).tenantId;
    const context = {
      job,
      jobId: ctx.id,
      attempt: ctx.attempt,
      tenantId: typeof tenantId === "string" ? tenantId : undefined,
    };
    const sentryEventId = reportError(error, context);
    logger.error({ err: error, sentryEventId, ...context }, "jobs: attempt failed");
    throw error;
  }
}
