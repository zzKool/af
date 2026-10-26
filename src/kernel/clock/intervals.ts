// Dated intervals on ISO days — both bounds inclusive, an open end is forever. The one rule behind "the rate valid
// on a date" (contracts, D24) and "the price valid on a date" (subscriptions, F94). Pure, no I/O.

export type DateInterval = { validFrom: string; validTo: string | null };

/** Inclusive calendar-day containment; open end = forever. ISO strings compare lexically. */
export function covers(r: DateInterval, date: string): boolean {
  return r.validFrom <= date && (r.validTo === null || r.validTo >= date);
}

export function overlaps(a: DateInterval, b: DateInterval): boolean {
  const aEnd = a.validTo ?? "9999-12-31";
  const bEnd = b.validTo ?? "9999-12-31";
  return a.validFrom <= bEnd && b.validFrom <= aEnd;
}

/** The one interval that contains `date`, or null. With non-overlapping input there is at most one. */
export function pickInterval<T extends DateInterval>(items: readonly T[], date: string): T | null {
  const hits = items.filter((r) => covers(r, date));
  if (hits.length === 0) return null;
  // Defensive: should the data ever overlap (an exclusion constraint forbids it), the latest start wins (v1 R6).
  return hits.reduce((best, r) => (r.validFrom > best.validFrom ? r : best));
}
