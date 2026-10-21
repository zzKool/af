import * as Sentry from "@sentry/nextjs";

/**
 * Who and what an unexpected error happened for. A Server Action fills user, tenant, request and
 * action; a job fills job, job id, attempt and the tenant from its payload.
 */
export interface ErrorContext {
  userId?: string;
  tenantId?: string | null;
  requestId?: string;
  action?: string;
  job?: string;
  jobId?: string;
  attempt?: number;
}

/**
 * Report an unexpected error to Sentry with its request context attached to the event itself — not to
 * a shared scope, so two concurrent requests never lend each other their user or tenant. Returns the
 * event id (the "Reference" the user can quote). No-op when Sentry has no DSN.
 */
export function reportError(error: unknown, context: ErrorContext): string {
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (key !== "userId" && value !== undefined && value !== null) tags[key] = String(value);
  }
  return Sentry.captureException(error, {
    user: context.userId ? { id: context.userId } : undefined,
    tags,
  });
}
