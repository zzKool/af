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
 *
 * `ACTION_RATE_LIMIT_PER_MINUTE` replaces the 300 — for the e2e run only (CI sets it): two browsers driving one
 * user through every journey at machine speed are not an owner, and the faster the runner the higher their
 * peak (measured 2026-11-14: ~650 actions in the suite, 178 in its busiest minute on a slow machine, twice that
 * on CI's — `Too many requests` then fails whichever journey is running). Unset everywhere else.
 */

const DEFAULT_MAX_REQUESTS = 300;
const DEFAULT_WINDOW_MS = 60_000;

/** The limit in force: the env override when it is a positive whole number, else 300. */
export function maxRequestsPerWindow(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.ACTION_RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return DEFAULT_MAX_REQUESTS;
  return Number(raw);
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  userId: string,
  maxRequests = maxRequestsPerWindow(),
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
