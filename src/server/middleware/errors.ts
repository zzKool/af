import type { AppError } from "@/types/app-error";

/**
 * Thrown by middleware to signal a business error.
 * handleServerError distinguishes ActionError from unexpected crashes
 * and passes through the AppError to the client via serverError.
 */
export class ActionError extends Error {
  public readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = "ActionError";
    this.appError = appError;
  }
}
