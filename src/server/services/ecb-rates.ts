import { XMLParser } from "fast-xml-parser";
import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/server/logger";
import type { Clock } from "./clock";

// ECB SDMX API — daily exchange rates
const ECB_API_BASE = process.env.ECB_API_BASE_URL || "https://data-api.ecb.europa.eu/service/data";

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
    date?: string;
    currencyPairs?: string[];
    lastN?: number;
  },
): Promise<EcbRateFetchResult> {
  const pairs = options?.currencyPairs ?? DEFAULT_CURRENCY_PAIRS;

  const url = buildEcbUrl(pairs, {
    startDate: options?.date,
    endDate: options?.date,
    lastN: options?.lastN ?? (options?.date ? undefined : 1),
  });

  const response = await fetch(url, {
    headers: { Accept: "application/xml" },
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

    const rowCount = await prisma.$executeRawUnsafe(
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      date,
      currencyPair,
      rate,
    );

    if (rowCount > 0) {
      inserted++;
    } else {
      skipped++;
    }

    rates.push({ date, currencyPair, rate: decimalRate });
  }

  logger.info({ inserted, skipped, total: parsed.length }, "ECB rates fetched and stored");

  return { inserted, skipped, rates };
}

/**
 * Look up cached rate for a given date and currency pair.
 * Falls back to nearest available date if exact date missing.
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

  // Fallback: nearest cached rate (prefer earlier date, then later)
  const nearestRows = (await prisma.$queryRawUnsafe(
    `SELECT date::text, currency_pair, rate::text FROM ecb_rates
     WHERE currency_pair = $1
     ORDER BY ABS(date - $2::date) ASC
     LIMIT 1`,
    currencyPair,
    date,
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
