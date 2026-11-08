// The rates page's reads (F136, spec US5, FR-011 – FR-012): the stored ECB rows over a span turned into one
// series per currency against the base, and the months from the first stored day with their missing days. Read
// only — the table is global (no tenant, no RLS); the base comes from the caller (the tenant's, D39).
import { Prisma } from "@/generated/prisma/client";
import { addDays, daysUntil } from "@/kernel/clock/calendar";
import { DEFAULT_CURRENCY_PAIRS, rateGaps, rateToBase } from "./ecb-rates";
import type { CurrencySeries, MonthCoverage, RateOnDay } from "./types";

type Db = { $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown[]> };
export type StoredRate = { date: string; pair: string; rate: string };

/** The stored rows of the fetched pairs between two days (both included), oldest first. */
export async function rateHistory(db: Db, from: string, to: string): Promise<StoredRate[]> {
  const rows = (await db.$queryRawUnsafe(
    `SELECT date::text AS date, currency_pair AS pair, rate::text AS rate FROM ecb_rates
     WHERE currency_pair = ANY($1::text[]) AND date >= $2::date AND date <= $3::date
     ORDER BY date, currency_pair`,
    [...DEFAULT_CURRENCY_PAIRS],
    from,
    to,
  )) as StoredRate[];
  return rows;
}

/** The first stored day of any fetched pair; null on an empty table. */
export async function firstRateDay(db: Db): Promise<string | null> {
  const rows = (await db.$queryRawUnsafe(
    `SELECT min(date)::text AS first FROM ecb_rates WHERE currency_pair = ANY($1::text[])`,
    [...DEFAULT_CURRENCY_PAIRS],
  )) as Array<{ first: string | null }>;
  return rows[0]?.first ?? null;
}

/**
 * One series per currency ≠ base: `1 X = rate × base` on each day both legs are stored — `EUR/base ÷ EUR/X`, EUR
 * itself a leg of 1 (the same cross as `rateToBase`), 6 decimals half-up, as decimal strings.
 */
export function crossSeries(
  rows: readonly StoredRate[],
  base: string,
  currencies: readonly string[],
): CurrencySeries[] {
  const byDay = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const day = byDay.get(r.date) ?? new Map<string, string>();
    day.set(r.pair, r.rate);
    byDay.set(r.date, day);
  }
  const leg = (day: Map<string, string>, c: string) => (c === "EUR" ? "1" : day.get(`EUR/${c}`));
  return currencies
    .filter((c) => c !== base)
    .map((currency) => {
      const points: CurrencySeries["points"] = [];
      for (const [date, day] of byDay) {
        const toBase = leg(day, base);
        const toX = leg(day, currency);
        if (!toBase || !toX) continue;
        points.push({
          date,
          rate: new Prisma.Decimal(toBase)
            .div(new Prisma.Decimal(toX))
            .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
            .toFixed(6),
        });
      }
      points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return { currency, points };
    });
}

/** `yyyy-mm` of an ISO day */
const monthOf = (day: string) => day.slice(0, 7);

/** Weekdays (Mon–Fri) of a month, as ISO days, up to `until` when given. */
function weekdaysOf(month: string, until?: string): string[] {
  const out: string[] = [];
  for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) {
    if (until && d > until) break;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d);
  }
  return out;
}

/**
 * The months from `first`'s month to `today`'s, each with its weekdays (up to today), how many of them are missing
 * (`missing` — the FR-009 gap days, any pair) and whether the month lies before the first stored day. Pure.
 */
export function monthCoverage(
  first: string | null,
  today: string,
  missing: readonly string[],
  options?: { from?: string },
): MonthCoverage[] {
  const start = options?.from ?? (first ? monthOf(first) : monthOf(today));
  const missingByMonth = new Map<string, number>();
  for (const d of new Set(missing))
    missingByMonth.set(monthOf(d), (missingByMonth.get(monthOf(d)) ?? 0) + 1);
  const out: MonthCoverage[] = [];
  for (let m = start; m <= monthOf(today); m = monthOf(addDays(`${m}-28`, 7))) {
    const before = !first || m < monthOf(first);
    out.push({
      month: m,
      weekdays: weekdaysOf(m, today).length,
      missing: before ? 0 : (missingByMonth.get(m) ?? 0),
      beforeFirst: before,
    });
  }
  return out;
}

/** The page's coverage: every month from the first stored day, the gaps of FR-009 over the whole span. */
export async function rateCoverage(
  db: Db,
  today: string,
): Promise<{ first: string | null; months: MonthCoverage[]; missingDays: string[] }> {
  const first = await firstRateDay(db);
  const windowDays = first ? Math.max(30, daysUntil(first, today) + 1) : 30;
  const gaps = await rateGaps(db, today, { windowDays });
  const missingDays = [...new Set(gaps.flatMap((g) => g.missingDays))].sort();
  // the grid starts in January of the first year — the months before the first rate show as such
  const from = first ? `${first.slice(0, 4)}-01` : undefined;
  return { first, months: monthCoverage(first, today, missingDays, { from }), missingDays };
}

/** Each currency ≠ base on a day (FR-013): the nearest-day rule of `rateToBase` (US4), with the day it comes from. */
export async function ratesOnDay(
  db: Db,
  date: string,
  base: string,
  currencies: readonly string[],
): Promise<RateOnDay[]> {
  const out: RateOnDay[] = [];
  for (const currency of currencies.filter((c) => c !== base)) {
    const r = await rateToBase(db, date, currency, base);
    out.push({
      currency,
      rate: r ? r.rate.toFixed(6) : null,
      source: r ? r.source : null,
      rateDate: r ? r.rateDate : null,
    });
  }
  return out;
}
