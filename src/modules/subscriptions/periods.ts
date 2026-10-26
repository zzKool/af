// The expected occurrences of a subscription (F94 FR-004, US2-1, US5): pure — the start date, the cadence, the
// end, the prices and the pauses in; the periods out. Nothing about a period is stored.
import { addDays } from "@/kernel/clock/calendar";
import { pickInterval } from "@/kernel/clock/intervals";
import type { Cadence, PauseDto, Period, PriceDto } from "./types";

/** A bank row may be booked from three days before to seven days after the expected date. */
export const ROW_WINDOW = [-3, 7] as const;
/** A receipt or bill may be dated ten days either side. */
export const RECEIPT_WINDOW = [-10, 10] as const;

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The `n`-th expected date from the anchor (`n = 0` is the anchor itself). Monthly keeps the anchor's day of month,
 * clamped to a shorter month's last day (31 Jan → 28 Feb → 31 Mar — the clamp never sticks); yearly keeps day and
 * month (29 Feb → 28 Feb in a common year).
 */
export function nthDate(start: string, cadence: Cadence, n: number): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  const months = cadence === "monthly" ? n : 12 * n;
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  return iso(year, month, Math.min(d, lastDayOfMonth(year, month)));
}

/** Every expected date from the anchor up to and including `until` (empty when `until` is before the start). */
export function expectedDates(start: string, cadence: Cadence, until: string): string[] {
  const out: string[] = [];
  for (let n = 0; ; n++) {
    const date = nthDate(start, cadence, n);
    if (date > until) return out;
    out.push(date);
  }
}

export type PeriodInput = {
  startDate: string;
  endDate: string | null;
  cadence: Cadence;
  prices: readonly Pick<PriceDto, "validFrom" | "validTo" | "amount" | "currency">[];
  pauses: readonly Pick<PauseDto, "fromDate" | "toDate">[];
};

/**
 * The periods from the start date (Q3 → A: the backlog counts) up to the end date, and at most one beyond today —
 * the next one, shown as upcoming. Oldest first.
 */
export function periodsOf(sub: PeriodInput, today: string): Period[] {
  const out: Period[] = [];
  for (let n = 0; ; n++) {
    const date = nthDate(sub.startDate, sub.cadence, n);
    if (sub.endDate !== null && date > sub.endDate) break;
    out.push(periodAt(sub, date));
    if (date > today) break;
  }
  return out;
}

export function periodAt(sub: PeriodInput, date: string): Period {
  const price = pickInterval(sub.prices, date);
  return {
    date,
    price: price ? { amount: price.amount, currency: price.currency } : null,
    rowWindow: { from: addDays(date, ROW_WINDOW[0]), to: addDays(date, ROW_WINDOW[1]) },
    receiptWindow: { from: addDays(date, RECEIPT_WINDOW[0]), to: addDays(date, RECEIPT_WINDOW[1]) },
    skipped: sub.pauses.some((p) => p.fromDate <= date && date <= p.toDate),
  };
}
