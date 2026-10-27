import { logger } from "@/kernel/logging/logger";

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
 * Report an unexpected error: one structured log line (pino JSON, D51: it stays on the box) carrying the
 * error, its context and a fresh **reference id** — the "Reference: …" the user can quote, found with
 * `grep` in the app log. Sentry left with F111 (audit D13): it was off on the box by D51 and 57 MB in the
 * image. The context goes on the line itself, never on a shared scope, so two concurrent requests never
 * lend each other their user or tenant.
 */
export function reportError(error: unknown, context: ErrorContext): string {
  // Web Crypto: the same call in Node and the edge runtime (instrumentation runs in both)
  const reference = globalThis.crypto.randomUUID().slice(0, 8);
  const fields: Record<string, string | number> = { reference };
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null) fields[key] = value as string | number;
  }
  logger.error({ err: error, ...fields }, "unexpected error");
  return reference;
}
