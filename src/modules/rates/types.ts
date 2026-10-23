// Public DTOs of the rates module. Plain types only — never Prisma types (constitution §2).
// Rates travel as decimal strings ("11.234567"), dates as ISO days ("2026-03-14").
// `BaseRateResult` (in ecb-rates.ts) still carries a Decimal — specs/rates/tasks.md T007.

/** What Settings → Exchange rates shows per pair: the newest stored day and how the last window looks. */
export type RatePairStatus = {
  pair: string;
  /** ISO date of the newest stored rate, null before the first fetch */
  latestDate: string | null;
  latestRate: string | null;
  /** stored ECB weekdays in the window */
  storedDays: number;
  /** ECB weekdays of the window (settled two days back) with no stored rate */
  missingWeekdays: number;
};

/**
 * Where a looked-up rate comes from — the same words as the `rate_source` a money fact stores:
 * the exact day (`ecb_daily`) or a day borrowed within the cap (`ecb_nearest`, F60).
 */
export type RateLookupSource = "ecb_daily" | "ecb_nearest";

/** `getRate`: 1 EUR = `rate` of the pair's other currency, on `actualDate`, asked for `date`. */
export type RateLookupResult = {
  date: string;
  currencyPair: string;
  /** decimal string, 6 dp as stored */
  rate: string;
  rateSource: RateLookupSource;
  actualDate: string;
};

/** `fetchDailyRates`: what the ECB answered and what was new. */
export type EcbRateFetchResult = {
  inserted: number;
  skipped: number;
  /** every observation of the answer, stored now or before; `rate` as the ECB sent it */
  rates: Array<{ date: string; currencyPair: string; rate: string }>;
};

/**
 * A gap in one pair's ECB rates (F81) — the ECB weekdays a money fact may be refused for want of a rate.
 * Inner: ≥ 3 weekdays between two stored days. Trailing (`to` null): no rate since `from` and `from` is
 * NEAREST_RATE_MAX_DAYS or more days old — the last day a fact dated today still borrows it.
 */
export type RateGap = {
  pair: string;
  /** the stored day before the gap; null when the pair has no rate at all */
  from: string | null;
  /** the stored day after the gap; null for the trailing gap */
  to: string | null;
  /** the ECB weekdays without a rate, inside the window */
  missingDays: string[];
};
