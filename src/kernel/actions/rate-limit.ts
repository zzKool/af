/**
 * In-memory sliding window rate limiter.
 *
 * Limitations:
 * - In-memory only — resets on server restart.
 * - Assumes single Node.js process. If Next.js uses worker threads
 *   or edge runtime, rate limiting becomes per-worker.
 * - Acceptable for 2-3 user app.
 */

const DEFAULT_MAX_REQUESTS = 60;
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
