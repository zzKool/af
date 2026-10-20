/**
 * In-memory sliding window rate limiter.
 *
 * Limitations:
 * - In-memory only — resets on server restart.
 * - Assumes single Node.js process. If Next.js uses worker threads
 *   or edge runtime, rate limiting becomes per-worker.
 * - Acceptable for 2-3 user app.
 *
 * The limit counts every Server Action — reads included: a filter popup, a side panel, an autosave are one each.
 * An active minute on a workbench (and the e2e suite's two workers on one user) sits well above 60, which is
 * why the limit is 300: a guard against a runaway loop, not a budget for a working owner.
 */

const DEFAULT_MAX_REQUESTS = 300;
const DEFAULT_WINDOW_MS = 60_000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  userId: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
): { allowed: boolean } {
  const now = Date.now();
  const entry = store.get(userId);

  // Lazy eviction: if expired, start fresh window
  if (!entry || now >= entry.resetAt) {
    store.set(userId, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    return { allowed: false };
  }

  return { allowed: true };
}

/** Clears all rate limit state. Required for test cleanup. */
export function resetRateLimit(): void {
  store.clear();
}
