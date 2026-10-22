import { XMLParser } from "fast-xml-parser";
import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/kernel/logging/logger";

// ECB SDMX API — daily exchange rates
const ECB_API_BASE = "https://data-api.ecb.europa.eu/service/data";

/** Fetch timeout — prevents indefinite hang if ECB API is unresponsive */
const FETCH_TIMEOUT_MS = 30_000;

const DEFAULT_CURRENCY_PAIRS = ["EUR/SEK", "EUR/CHF", "EUR/USD"];

export interface EcbRateFetchResult {
  inserted: number;
  skipped: number;
  rates: Array<{ date: string; currencyPair: string; rate: Prisma.Decimal }>;
}

export type RateSource = "ecb_daily" | "cached";

export interface RateLookupResult {
  date: string;
  currencyPair: string;
  rate: Prisma.Decimal;
  rateSource: RateSource;
  actualDate: string;
}

import type { RatePairStatus } from "./types";

export interface DateGap {
  from: string;
  to: string;
  missingWeekdays: number;
}

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
  currencyPairs: string[],
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
 * Fetch daily rates from the ECB SDMX API.
 * Parses XML and stores rates in the ecb_rates table.
 * Uses ON CONFLICT DO NOTHING for idempotent inserts.
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
    const decimalRate = new Prisma.Decimal(rate);

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

    rates.push({ date, currencyPair, rate: decimalRate });
  }

  logger.info({ inserted, skipped, total: parsed.length }, "ECB rates fetched and stored");

  return { inserted, skipped, rates };
}

/**
 * The argument of `scripts/fetch-rates.ts`: a day (`2023-04-01`) backfills from that day,
 * a number keeps the last N observations, nothing means the last 400 (≈ 18 months of weekdays).
 * Returns null when the argument is neither, or the day is not a real past day.
 */
export function fetchRatesArgToOptions(
  arg: string | undefined,
  today: string = new Date().toISOString().slice(0, 10),
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
 * Exact day → `ecb_daily`. Otherwise the nearest stored day within NEAREST_RATE_MAX_DAYS → `cached`:
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
      rate: new Prisma.Decimal(exactRows[0].rate),
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
      rate: new Prisma.Decimal(nearestRows[0].rate),
      rateSource: "cached",
      actualDate: nearestRows[0].date,
    };
  }

  return null;
}

/**
 * Detect gaps in cached rates (> 3 weekdays missing).
 * ECB publishes on weekdays only — weekends are expected gaps.
 */
export async function detectGaps(
  prisma: { $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown[]> },
  currencyPair: string,
  fromDate: string,
  toDate: string,
): Promise<DateGap[]> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT date::text FROM ecb_rates
     WHERE currency_pair = $1 AND date >= $2::date AND date <= $3::date
     ORDER BY date ASC`,
    currencyPair,
    fromDate,
    toDate,
  )) as Array<{ date: string }>;

  if (rows.length < 2) return [];

  const gaps: DateGap[] = [];

  for (let i = 1; i < rows.length; i++) {
    const prevDate = new Date(rows[i - 1].date);
    const currDate = new Date(rows[i].date);

    // Count weekdays between the two dates (exclusive of both endpoints)
    const missingWeekdays = countWeekdaysBetween(prevDate, currDate);

    if (missingWeekdays >= 3) {
      gaps.push({
        from: rows[i - 1].date,
        to: rows[i].date,
        missingWeekdays,
      });
    }
  }

  return gaps;
}

/**
 * Count weekdays between two dates (exclusive of both endpoints).
 * Mon-Fri = weekday. Sat-Sun = weekend.
 */
export function countWeekdaysBetween(from: Date, to: Date): number {
  let count = 0;
  const current = new Date(from);
  current.setDate(current.getDate() + 1); // Start day after 'from'

  while (current < to) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

// Export for testing
export { parseEcbXml, buildEcbUrl };

export type BaseRateResult = {
  /** 1 unit of `from` = rate × `to`, 6 decimals */
  rate: Prisma.Decimal;
  /** `same_currency` | `ecb_daily` (both legs on the exact date) | `ecb_nearest` (a leg fell back to the nearest cached day) */
  source: "same_currency" | "ecb_daily" | "ecb_nearest";
  /** the day the rate actually comes from */
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
  const leg = async (ccy: string) =>
    ccy === "EUR"
      ? { rate: new Prisma.Decimal(1), rateSource: "ecb_daily" as RateSource, actualDate: date }
      : await getRate(db, date, `EUR/${ccy}`);
  const [eurTo, eurFrom] = await Promise.all([leg(to), leg(from)]);
  if (!eurTo || !eurFrom) return null;
  const nearest = eurTo.rateSource === "cached" || eurFrom.rateSource === "cached";
  return {
    rate: eurTo.rate.div(eurFrom.rate).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP),
    source: nearest ? "ecb_nearest" : "ecb_daily",
    rateDate: nearest
      ? eurTo.rateSource === "cached"
        ? eurTo.actualDate
        : eurFrom.actualDate
      : date,
  };
}

/** Weekdays between `from` and `to`, both inclusive. */
function weekdaysInclusive(from: Date, to: Date): number {
  let count = 0;
  const current = new Date(from);
  while (current <= to) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count += 1;
    current.setDate(current.getDate() + 1);
  }
  return count;
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
  const to = new Date(today);
  const from = new Date(to);
  from.setDate(from.getDate() - windowDays);
  const settled = new Date(to);
  settled.setDate(settled.getDate() - 2);
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
    from.toISOString().slice(0, 10),
    settled.toISOString().slice(0, 10),
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
