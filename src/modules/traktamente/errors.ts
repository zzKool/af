// The module's AppError builders, written once (lessons audit 32: trip.ts and rates.ts each had their own copy).
import type { AppError } from "@/kernel/errors/app-error";

/** A business rule refused the write; `details` are the facts a screen renders in its own language. */
export const violation = (
  message: string,
  details?: Record<string, string | number>,
): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});

export const invalid = (message: string): AppError => ({
  code: "VALIDATION_ERROR",
  message,
  retryable: false,
});

export const notFound = (what: string, id: string): AppError => ({
  code: "NOT_FOUND",
  message: `${what} not found: ${id}`,
  retryable: false,
});
