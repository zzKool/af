// Which period an attributed entity fills (F94 US2-5) — pure: the expected date nearest to the entity's date, a tie
// going to the earlier period. An entity is never dropped: one dated before the start fills the first period.
import { daysBetween } from "@/kernel/clock/calendar";

export function nearestPeriod(dates: readonly string[], date: string): number {
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  dates.forEach((d, i) => {
    const gap = daysBetween(d, date);
    if (gap < bestGap) {
      best = i;
      bestGap = gap; // equal gaps keep the earlier one: the dates are in order
    }
  });
  return best;
}

/** The entities of each period, by the period's index; oldest entity first. */
export function attribute<T extends { id: string; date: string }>(
  dates: readonly string[],
  entities: readonly T[],
): Map<number, T[]> {
  const out = new Map<number, T[]>();
  if (dates.length === 0) return out;
  const sorted = [...entities].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  for (const e of sorted) {
    const i = nearestPeriod(dates, e.date);
    out.set(i, [...(out.get(i) ?? []), e]);
  }
  return out;
}
