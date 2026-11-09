// Calendar-day arithmetic on ISO `YYYY-MM-DD` strings — no timezone, no Date instants.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** The UTC midnight of an ISO day, in ms — a calendar day, never a local time (DST cannot shift it). */
function dayMs(iso: string): number {
  if (!ISO.test(iso)) throw new Error(`Expected an ISO date (yyyy-mm-dd), got "${iso}"`);
  const ms = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new Error(`Expected an ISO date (yyyy-mm-dd), got "${iso}"`);
  return ms;
}

/** `addDays("2026-01-01", -1)` → `"2025-12-31"`. `days` a whole number. */
export function addDays(iso: string, days: number): string {
  const d = new Date(dayMs(iso));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Signed whole days from one ISO day to another: `daysUntil("2026-03-28", "2026-03-30")` → `2`, backwards negative. */
export function daysUntil(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** Whole calendar days between two ISO days, either order: `daysBetween("2026-03-30", "2026-03-28")` → `2`. */
export function daysBetween(a: string, b: string): number {
  return Math.abs(daysUntil(a, b));
}

/** The `n` months up to `today`'s, oldest first: `lastMonths("2026-07-15", 3)` → `2026-05`, `2026-06`, `2026-07`. */
export function lastMonths(today: string, n = 12): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}
