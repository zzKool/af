/**
 * Extract error message from a next-safe-action result.
 * Handles both serverError and data.error shapes.
 */
export function extractError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.serverError && typeof r.serverError === "object") {
    return (r.serverError as { message?: string }).message ?? "An error occurred";
  }
  if (r.data && typeof r.data === "object" && (r.data as Record<string, unknown>).error) {
    const err = (r.data as Record<string, unknown>).error as { message?: string };
    return err.message ?? "An error occurred";
  }
  return null;
}
