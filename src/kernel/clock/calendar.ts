// Calendar-day arithmetic on ISO `YYYY-MM-DD` strings — no timezone, no Date instants.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** `addDays("2026-01-01", -1)` → `"2025-12-31"`. */
export function addDays(iso: string, days: number): string {
  if (!ISO.test(iso)) throw new Error(`Expected an ISO date (yyyy-mm-dd), got "${iso}"`);
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
