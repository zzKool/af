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
};

/** Result of a service call: either data or an AppError — services never throw for business errors. */
export type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };
