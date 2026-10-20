export type ErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "DUPLICATE_ENTRY"
  | "VALIDATION_ERROR"
  | "BUSINESS_RULE_VIOLATION"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type AppError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  /** Optional structured facts behind the message (ids, dates, counts) so a client can render it in its own language. */
  details?: Record<string, string | number>;
};

/** Result of a service call: either data or an AppError — services never throw for business errors. */
export type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

/**
 * Thrown — never returned — by a service when a step AFTER its first write fails: a returned `ServiceResult`
 * error would let the surrounding transaction commit the partial write. The action client translates it into
 * `appError` for the client, exactly like a returned error, once the transaction has rolled back.
 */
export class RollbackError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message);
    this.name = "RollbackError";
  }
}
