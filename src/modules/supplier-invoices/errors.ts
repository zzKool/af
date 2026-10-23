// The service's error constructors — every write returns its refusals through these.
import type { AppError } from "@/kernel/errors/app-error";

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
