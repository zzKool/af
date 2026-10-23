import { XMLParser } from "fast-xml-parser";
import { Prisma } from "@/generated/prisma/client";
import { addDays, daysUntil } from "@/kernel/clock/calendar";
import { logger } from "@/kernel/logging/logger";
import { CURRENCIES } from "@/kernel/nav/constants";
import type {
  EcbRateFetchResult,
  RateGap,
  RateLookupResult,
  RateLookupSource,
  RatePairStatus,
} from "./types";

// ECB SDMX API — daily exchange rates
const ECB_API_BASE = "https://data-api.ecb.europa.eu/service/data";

/** Fetch timeout — prevents indefinite hang if ECB API is unresponsive */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * The ECB pairs fetched: one `EUR/X` per currency the app knows, EUR itself aside (the ECB's reference rates are
 * all against EUR). Derived, so a currency added to `CURRENCIES` is fetched without a second list (audit 30).
 */
export const DEFAULT_CURRENCY_PAIRS: readonly string[] = CURRENCIES.filter((c) => c !== "EUR").map(
  (c) => `EUR/${c}`,
);

// XML parser configured for ECB SDMX format
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "generic:Series" || name === "generic:Obs",
});

interface EcbXmlSeries {
  "generic:SeriesKey": {
    "generic:Value":
      | Array<{ "@_id": string; "@_value": string }>
      | { "@_id": string; "@_value": string };
  };
  "generic:Obs": Array<{
    "generic:ObsDimension": { "@_value": string };
    "generic:ObsValue": { "@_value": string };
  }>;
}

function parseEcbXml(xml: string): Array<{ date: string; currency: string; rate: string }> {
  const parsed = xmlParser.parse(xml);
  const dataSet = parsed["message:GenericData"]?.["message:DataSet"];
  if (!dataSet) return [];

  const seriesList: EcbXmlSeries[] = Array.isArray(dataSet["generic:Series"])
    ? dataSet["generic:Series"]
    : dataSet["generic:Series"]
      ? [dataSet["generic:Series"]]
      : [];

  const results: Array<{ date: string; currency: string; rate: string }> = [];

  for (const series of seriesList) {
    const keyValues = Array.isArray(series["generic:SeriesKey"]["generic:Value"])
      ? series["generic:SeriesKey"]["generic:Value"]
      : [series["generic:SeriesKey"]["generic:Value"]];

    const currency = keyValues.find((v) => v["@_id"] === "CURRENCY")?.["@_value"];
    if (!currency) continue;

    const observations = series["generic:Obs"] ?? [];
    for (const obs of observations) {
      const date = obs["generic:ObsDimension"]["@_value"];
      const rate = obs["generic:ObsValue"]["@_value"];
      if (date && rate) {
        results.push({ date, currency, rate });
      }
    }
  }

  return results;
}

/**
 * Build the ECB SDMX API URL for daily rates.
 * Format: EXR/D.{currencies}.EUR.SP00.A
 * Note: ECB uses CURRENCY/CURRENCY_DENOM, so EUR/SEK means "1 EUR = X SEK"
 * which is what we store. The API key uses the non-EUR currency.
 */
function buildEcbUrl(
  currencyPairs: readonly string[],
  options?: { startDate?: string; endDate?: string; lastN?: number },
): string {
  // Extract non-EUR currencies from pairs like "EUR/SEK" → "SEK"
  const currencies = currencyPairs.map((pair) => {
    const [base, quote] = pair.split("/");
    return base === "EUR" ? quote : base;
  });

  let url = `${ECB_API_BASE}/EXR/D.${currencies.join("+")}.EUR.SP00.A?detail=dataonly`;

  if (options?.lastN) {
    url += `&lastNObservations=${options.lastN}`;
  }
  if (options?.startDate) {
    url += `&startPeriod=${options.startDate}`;
  }
  if (options?.endDate) {
    url += `&endPeriod=${options.endDate}`;
  }

  return url;
}

/**
 * Fetch daily rates from the ECB SDMX API, parse the XML and insert each observation into ecb_rates.
 * Idempotent: a day already stored hits the primary key and is counted as skipped, the stored value unchanged
 * (the duplicate-key error is caught — ecb_rates' immutability RULEs forbid ON CONFLICT).
 *
 * This service operates OUTSIDE the tenant boundary —
 * ecb_rates has no tenantId, no RLS. Uses base Prisma client directly.
 */
export async function fetchDailyRates(
  prisma: { $executeRawUnsafe: (query: string, ...args: unknown[]) => Promise<number> },
  options?: {
    /** One day: start and end of the range. */
    date?: string;
    /** Backfill: every observation from this day to the latest (ignored when `date` is set). */
    startDate?: string;
    currencyPairs?: string[];
    lastN?: number;
  },
): Promise<EcbRateFetchResult> {
  const pairs = options?.currencyPairs ?? DEFAULT_CURRENCY_PAIRS;
  const startDate = options?.date ?? options?.startDate;

  const url = buildEcbUrl(pairs, {
    startDate,
    endDate: options?.date,
    lastN: options?.lastN ?? (startDate ? undefined : 1),
  });

  const response = await fetch(url, {
    headers: { Accept: "application/xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`ECB API error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = parseEcbXml(xml);

  let inserted = 0;
  let skipped = 0;
  const rates: EcbRateFetchResult["rates"] = [];

  for (const { date, currency, rate } of parsed) {
    const currencyPair = `EUR/${currency}`;

    // Cannot use ON CONFLICT DO NOTHING — ecb_rates has PostgreSQL RULEs
    // (immutability enforcement) which are incompatible with ON CONFLICT.
    // Use try/catch to handle duplicate key gracefully instead.
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, $2, $3)`,
        date,
        currencyPair,
        rate,
      );
      inserted++;
    } catch (err) {
      if (err instanceof Error && /unique constraint|duplicate key/i.test(err.message)) {
        skipped++;
      } else {
        throw err;
      }
    }

    rates.push({ date, currencyPair, rate });
  }

  logger.info({ inserted, skipped, total: parsed.length }, "ECB rates fetched and stored");

  return { inserted, skipped, rates };
}

/**
 * The argument of `scripts/fetch-rates.ts`: a day (`2023-04-01`) backfills from that day,
 * a number keeps the last N observations, nothing means the last 400 (≈ 18 months of weekdays).
 * Returns null when the argument is neither, or the day is not a real past day. `today` is the Stockholm day
 * (`clock.today()`), never the UTC one — between 00:00 and 02:00 Stockholm that would refuse today (V8).
 */
export function fetchRatesArgToOptions(
  arg: string | undefined,
  today: string,
): { startDate: string } | { lastN: number } | null {
  if (arg === undefined || arg === "") return { lastN: 400 };
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    const parsed = new Date(`${arg}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== arg) return null;
    if (arg > today) return null;
    return { startDate: arg };
  }
  if (/^\d+$/.test(arg)) return { lastN: Math.max(1, Math.min(2000, Number(arg))) };
  return null;
}

/**
 * How far (calendar days) a missing day may borrow another day's rate. 4 covers every TARGET closure:
 * a weekend (Sat/Sun → Fri), a holiday next to a weekend (Mon → Fri = 3), Easter Monday (→ Thursday = 4).
 * Beyond it the gap is a sync gap, not a market holiday — and the rate is written once (D3), so we refuse.
 */
export const NEAREST_RATE_MAX_DAYS = 4;

/**
 * Look up the cached rate for a date and currency pair.
 * Exact day → `ecb_daily`. Otherwise the nearest stored day within NEAREST_RATE_MAX_DAYS → `ecb_nearest`:
 * an earlier day always wins over a later one (Sunday → Friday, a mid-week holiday → the day before), the
 * closest earlier first; a later day only when no earlier one is in reach (e.g. the first day of a backfill).
 * The date is unique per pair, so the choice is deterministic. Null beyond the cap — the caller says
 * "run the ECB sync" rather than lock a guessed rate.
 */
export async function getRate(
  prisma: { $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown[]> },
  date: string,
  currencyPair: string,
): Promise<RateLookupResult | null> {
  // Try exact date first
  const exactRows = (await prisma.$queryRawUnsafe(
    `SELECT date::text, currency_pair, rate::text FROM ecb_rates WHERE date = $1 AND currency_pair = $2`,
    date,
    currencyPair,
  )) as Array<{ date: string; currency_pair: string; rate: string }>;

  if (exactRows.length > 0) {
    return {
      date,
      currencyPair: exactRows[0].currency_pair,
      rate: exactRows[0].rate,
      rateSource: "ecb_daily",
      actualDate: exactRows[0].date,
    };
  }

  // Fallback: within the cap, earlier days before later ones, then the closest.
  const nearestRows = (await prisma.$queryRawUnsafe(
    `SELECT date::text, currency_pair, rate::text FROM ecb_rates
     WHERE currency_pair = $1
       AND date BETWEEN $2::date - $3::int AND $2::date + $3::int
     ORDER BY (date > $2::date) ASC, ABS(date - $2::date) ASC
     LIMIT 1`,
    currencyPair,
    date,
    NEAREST_RATE_MAX_DAYS,
  )) as Array<{ date: string; currency_pair: string; rate: string }>;

  if (nearestRows.length > 0) {
    return {
      date,
      currencyPair: nearestRows[0].currency_pair,
      rate: nearestRows[0].rate,
      rateSource: "ecb_nearest",
      actualDate: nearestRows[0].date,
    };
  }

  return null;
}

/** Inner gaps start at 3 missing weekdays: the longest TARGET closure is 2 (Good Friday + Easter Monday). */
const GAP_MIN_WEEKDAYS = 3;

/** An ISO day falls Monday–Friday — read on the calendar day itself, never on a local-time instant (audit 28). */
function isWeekday(day: string): boolean {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** The ECB weekdays strictly between two ISO days. */
function weekdaysStrictlyBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) if (isWeekday(d)) days.push(d);
  return days;
}

/**
 * The gaps of the last `windowDays` days, per pair (F81) — the warning that matches `getRate`'s refusal:
 * - **inner**: ≥ 3 ECB weekdays without a rate between two stored days (Fri → Mon and a TARGET closure are not gaps);
 * - **trailing**: no rate since the pair's newest stored day, once that day is NEAREST_RATE_MAX_DAYS old —
 *   the last day a fact dated today still borrows it, so the warning shows the day before `getRate` refuses
 *   (and a pair never stored is one trailing gap over the whole window).
 * Each pair on its own: a CHF gap shows while SEK is current. `today` is the Stockholm day (`clock.today()`).
 */
export async function rateGaps(
  db: { $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown[]> },
  today: string,
  options?: { currencyPairs?: string[]; windowDays?: number },
): Promise<RateGap[]> {
  const pairs = options?.currencyPairs ?? DEFAULT_CURRENCY_PAIRS;
  const windowStart = addDays(today, -(options?.windowDays ?? 30));
  // the window's stored days per pair, plus the newest one before it (the gap may have started earlier)
  const rows = (await db.$queryRawUnsafe(
    `SELECT r.currency_pair, r.date::text AS date FROM ecb_rates r
     WHERE r.currency_pair = ANY($1::text[]) AND r.date <= $3::date
       AND (r.date >= $2::date
            OR r.date = (SELECT max(p.date) FROM ecb_rates p
                         WHERE p.currency_pair = r.currency_pair AND p.date < $2::date))
     ORDER BY r.currency_pair, r.date`,
    pairs,
    windowStart,
    today,
  )) as Array<{ currency_pair: string; date: string }>;
  const stored = new Map<string, string[]>();
  for (const r of rows)
    stored.set(r.currency_pair, [...(stored.get(r.currency_pair) ?? []), r.date]);

  const inWindow = (days: string[]) => days.filter((d) => d >= windowStart);
  const gaps: RateGap[] = [];
  for (const pair of pairs) {
    const days = stored.get(pair) ?? [];
    for (let i = 1; i < days.length; i++) {
      const missing = weekdaysStrictlyBetween(days[i - 1], days[i]);
      const missingDays = inWindow(missing);
      if (missing.length >= GAP_MIN_WEEKDAYS && missingDays.length > 0)
        gaps.push({ pair, from: days[i - 1], to: days[i], missingDays });
    }
    const newest = days.at(-1) ?? null;
    if (newest === null || daysUntil(newest, today) >= NEAREST_RATE_MAX_DAYS) {
      const missingDays = inWindow(
        weekdaysStrictlyBetween(newest ?? addDays(windowStart, -1), today),
      );
      if (missingDays.length > 0) gaps.push({ pair, from: newest, to: null, missingDays });
    }
  }
  return gaps;
}

/** Weekdays (Mon–Fri) strictly between two ISO days, both ends excluded: Fri → Mon is 0. */
export function countWeekdaysBetween(from: string, to: string): number {
  return weekdaysStrictlyBetween(from, to).length;
}

// Export for testing
export { parseEcbXml, buildEcbUrl };

/**
 * What `rateToBase` hands the modules that write a money fact. Still a Decimal, unlike the module's other DTOs
 * (types.ts): six modules compute with it — a decimal string, or a constitution line allowing a Decimal between
 * services, is specs/rates/tasks.md T007.
 */
export type BaseRateResult = {
  /** 1 unit of `from` = rate × `to`, 6 decimals */
  rate: Prisma.Decimal;
  /** `same_currency` | `ecb_daily` (both legs on the exact date) | `ecb_nearest` (a leg borrowed a nearby day) */
  source: "same_currency" | RateLookupSource;
  /** the day the rate actually comes from — when both legs borrowed, the earlier of their days */
  rateDate: string;
};

/**
 * Conversion rate `from` → `to` on `date` from the ECB reference rates (EUR-based: X/Y = EUR/Y ÷ EUR/X).
 * Used once, at issue, to write the SEK base of a non-SEK document (D3, D4). Null when a leg has no rate on the
 * day nor within NEAREST_RATE_MAX_DAYS of it (see getRate) — callers refuse with "run the ECB sync".
 */
export async function rateToBase(
  db: { $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown[]> },
  date: string,
  from: string,
  to: string,
): Promise<BaseRateResult | null> {
  if (from === to) return { rate: new Prisma.Decimal(1), source: "same_currency", rateDate: date };
  const leg = async (ccy: string): Promise<RateLookupResult | null> =>
    ccy === "EUR"
      ? { date, currencyPair: "EUR/EUR", rate: "1", rateSource: "ecb_daily", actualDate: date }
      : await getRate(db, date, `EUR/${ccy}`);
  const [eurTo, eurFrom] = await Promise.all([leg(to), leg(from)]);
  if (!eurTo || !eurFrom) return null;
  const borrowed = [eurTo, eurFrom]
    .filter((l) => l.rateSource === "ecb_nearest")
    .map((l) => l.actualDate);
  return {
    rate: new Prisma.Decimal(eurTo.rate)
      .div(new Prisma.Decimal(eurFrom.rate))
      .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP),
    source: borrowed.length > 0 ? "ecb_nearest" : "ecb_daily",
    // one leg borrowed → its day; both, on different days → the earlier (T004)
    rateDate: borrowed.length > 0 ? borrowed.sort()[0] : date,
  };
}

/** Weekdays between two ISO days, both inclusive. */
function weekdaysInclusive(from: string, to: string): number {
  return countWeekdaysBetween(addDays(from, -1), addDays(to, 1));
}

/**
 * Per pair: the newest stored day and the coverage of the last `windowDays` days (ECB weekdays with no stored
 * rate — the last two weekdays are never counted, the ECB publishes around 16:00 CET and the rate lands later).
 */
export async function rateStatus(
  prisma: { $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown[]> },
  today: string,
  options?: { currencyPairs?: string[]; windowDays?: number },
): Promise<RatePairStatus[]> {
  const pairs = options?.currencyPairs ?? DEFAULT_CURRENCY_PAIRS;
  const windowDays = options?.windowDays ?? 30;
  const from = addDays(today, -windowDays);
  const settled = addDays(today, -2);
  const expected = weekdaysInclusive(from, settled);

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT currency_pair,
            max(date)::text AS latest_date,
            (array_agg(rate::text ORDER BY date DESC))[1] AS latest_rate,
            count(*) FILTER (WHERE date >= $2::date AND date <= $3::date AND extract(isodow FROM date) < 6)::int AS stored_days
     FROM ecb_rates
     WHERE currency_pair = ANY($1::text[])
     GROUP BY currency_pair`,
    pairs,
    from,
    settled,
  )) as Array<{
    currency_pair: string;
    latest_date: string | null;
    latest_rate: string | null;
    stored_days: number;
  }>;
  const byPair = new Map(rows.map((r) => [r.currency_pair, r]));
  return pairs.map((pair) => {
    const r = byPair.get(pair);
    const storedDays = r?.stored_days ?? 0;
    return {
      pair,
      latestDate: r?.latest_date ?? null,
      latestRate: r?.latest_rate ?? null,
      storedDays,
      missingWeekdays: Math.max(0, expected - storedDays),
    };
  });
}
