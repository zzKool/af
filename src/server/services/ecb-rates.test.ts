import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { MIGRATION_URL } from "../db/test-setup";
import { buildEcbUrl, countWeekdaysBetween, detectGaps, getRate, parseEcbXml } from "./ecb-rates";

// Admin pool — ecb_rates has no RLS, so we use admin for all operations.
let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: MIGRATION_URL });
});

beforeEach(async () => {
  await adminPool.query("TRUNCATE ecb_rates");
});

afterAll(async () => {
  await adminPool.end();
});

async function insertRate(date: string, currencyPair: string, rate: string): Promise<void> {
  await adminPool.query(`INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, $2, $3)`, [
    date,
    currencyPair,
    rate,
  ]);
}

describe("ecb_rates immutability", () => {
  it("UPDATE has no effect — rowCount 0 and original data unchanged", async () => {
    await insertRate("2026-03-10", "EUR/SEK", "11.234567");

    const result = await adminPool.query(
      `UPDATE ecb_rates SET rate = 99.999999 WHERE date = '2026-03-10' AND currency_pair = 'EUR/SEK'`,
    );
    expect(result.rowCount).toBe(0);

    // Verify original data intact
    const { rows } = await adminPool.query(
      `SELECT rate::text FROM ecb_rates WHERE date = '2026-03-10' AND currency_pair = 'EUR/SEK'`,
    );
    expect(rows[0].rate).toBe("11.234567");
  });

  it("DELETE has no effect — rowCount 0 and data still exists", async () => {
    await insertRate("2026-03-10", "USD/SEK", "10.567890");

    const result = await adminPool.query(
      `DELETE FROM ecb_rates WHERE date = '2026-03-10' AND currency_pair = 'USD/SEK'`,
    );
    expect(result.rowCount).toBe(0);

    // Verify data still exists
    const { rows } = await adminPool.query(
      `SELECT rate::text FROM ecb_rates WHERE date = '2026-03-10' AND currency_pair = 'USD/SEK'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rate).toBe("10.567890");
  });

  it("INSERT succeeds for new rate (happy path)", async () => {
    await insertRate("2026-03-11", "CHF/SEK", "12.345678");

    const { rows } = await adminPool.query(
      `SELECT date::text, currency_pair, rate::text, fetched_at FROM ecb_rates WHERE date = '2026-03-11' AND currency_pair = 'CHF/SEK'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-03-11");
    expect(rows[0].currency_pair).toBe("CHF/SEK");
    expect(rows[0].rate).toBe("12.345678");
    expect(rows[0].fetched_at).toBeInstanceOf(Date);
  });

  it("duplicate INSERT with same (date, currency_pair) throws unique constraint error", async () => {
    await insertRate("2026-03-10", "EUR/SEK", "11.234567");

    await expect(insertRate("2026-03-10", "EUR/SEK", "99.999999")).rejects.toThrow(
      /unique constraint|duplicate key/i,
    );
  });
});

describe("parseEcbXml", () => {
  const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<message:GenericData xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message" xmlns:generic="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic">
<message:DataSet>
<generic:Series>
<generic:SeriesKey>
<generic:Value id="FREQ" value="D"/>
<generic:Value id="CURRENCY" value="SEK"/>
<generic:Value id="CURRENCY_DENOM" value="EUR"/>
</generic:SeriesKey>
<generic:Obs>
<generic:ObsDimension value="2026-03-14"/>
<generic:ObsValue value="11.2345"/>
</generic:Obs>
<generic:Obs>
<generic:ObsDimension value="2026-03-13"/>
<generic:ObsValue value="11.1234"/>
</generic:Obs>
</generic:Series>
<generic:Series>
<generic:SeriesKey>
<generic:Value id="FREQ" value="D"/>
<generic:Value id="CURRENCY" value="CHF"/>
<generic:Value id="CURRENCY_DENOM" value="EUR"/>
</generic:SeriesKey>
<generic:Obs>
<generic:ObsDimension value="2026-03-14"/>
<generic:ObsValue value="0.9041"/>
</generic:Obs>
</generic:Series>
</message:DataSet>
</message:GenericData>`;

  it("parses multiple series with multiple observations", () => {
    const result = parseEcbXml(SAMPLE_XML);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: "2026-03-14", currency: "SEK", rate: "11.2345" });
    expect(result[1]).toEqual({ date: "2026-03-13", currency: "SEK", rate: "11.1234" });
    expect(result[2]).toEqual({ date: "2026-03-14", currency: "CHF", rate: "0.9041" });
  });

  it("returns empty array for empty XML", () => {
    const result = parseEcbXml("<message:GenericData></message:GenericData>");
    expect(result).toEqual([]);
  });

  it("handles single series (not wrapped in array)", () => {
    const singleXml = `<?xml version="1.0" encoding="UTF-8"?>
<message:GenericData xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message" xmlns:generic="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic">
<message:DataSet>
<generic:Series>
<generic:SeriesKey>
<generic:Value id="CURRENCY" value="USD"/>
</generic:SeriesKey>
<generic:Obs>
<generic:ObsDimension value="2026-03-14"/>
<generic:ObsValue value="1.0876"/>
</generic:Obs>
</generic:Series>
</message:DataSet>
</message:GenericData>`;
    const result = parseEcbXml(singleXml);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: "2026-03-14", currency: "USD", rate: "1.0876" });
  });
});

describe("buildEcbUrl", () => {
  it("builds URL for multiple currency pairs", () => {
    const url = buildEcbUrl(["EUR/SEK", "EUR/CHF", "EUR/USD"]);
    expect(url).toContain("EXR/D.SEK+CHF+USD.EUR.SP00.A");
    expect(url).toContain("detail=dataonly");
  });

  it("includes date range parameters", () => {
    const url = buildEcbUrl(["EUR/SEK"], { startDate: "2026-03-01", endDate: "2026-03-14" });
    expect(url).toContain("startPeriod=2026-03-01");
    expect(url).toContain("endPeriod=2026-03-14");
  });

  it("includes lastNObservations parameter", () => {
    const url = buildEcbUrl(["EUR/SEK"], { lastN: 5 });
    expect(url).toContain("lastNObservations=5");
  });
});

describe("getRate", () => {
  it("returns exact match with rateSource ecb_daily", async () => {
    await insertRate("2026-03-14", "EUR/SEK", "11.234567");

    const result = await getRate(
      {
        $queryRawUnsafe: (q: string, ...args: unknown[]) =>
          adminPool.query(q, args).then((r) => r.rows),
      },
      "2026-03-14",
      "EUR/SEK",
    );

    expect(result).not.toBeNull();
    expect(result!.rateSource).toBe("ecb_daily");
    expect(result!.rate.toString()).toBe("11.234567");
    expect(result!.actualDate).toBe("2026-03-14");
  });

  it("falls back to nearest cached rate when exact date missing", async () => {
    await insertRate("2026-03-13", "EUR/SEK", "11.111111");
    // No rate for 2026-03-14 (weekend)

    const result = await getRate(
      {
        $queryRawUnsafe: (q: string, ...args: unknown[]) =>
          adminPool.query(q, args).then((r) => r.rows),
      },
      "2026-03-14",
      "EUR/SEK",
    );

    expect(result).not.toBeNull();
    expect(result!.rateSource).toBe("cached");
    expect(result!.actualDate).toBe("2026-03-13");
    expect(result!.date).toBe("2026-03-14"); // Requested date preserved
  });

  it("returns null when no rates exist", async () => {
    const result = await getRate(
      {
        $queryRawUnsafe: (q: string, ...args: unknown[]) =>
          adminPool.query(q, args).then((r) => r.rows),
      },
      "2026-03-14",
      "EUR/SEK",
    );
    expect(result).toBeNull();
  });
});

describe("countWeekdaysBetween", () => {
  it("Friday → Monday is 0 missing weekdays (normal weekend)", () => {
    // 2026-03-13 is Friday, 2026-03-16 is Monday
    const count = countWeekdaysBetween(new Date("2026-03-13"), new Date("2026-03-16"));
    expect(count).toBe(0);
  });

  it("Friday → Wednesday is 2 missing weekdays (Monday + Tuesday)", () => {
    // 2026-03-13 is Friday, 2026-03-18 is Wednesday
    const count = countWeekdaysBetween(new Date("2026-03-13"), new Date("2026-03-18"));
    expect(count).toBe(2);
  });

  it("Friday → Thursday is 3 missing weekdays (Mon + Tue + Wed)", () => {
    // 2026-03-13 is Friday, 2026-03-19 is Thursday
    const count = countWeekdaysBetween(new Date("2026-03-13"), new Date("2026-03-19"));
    expect(count).toBe(3);
  });

  it("Monday → Tuesday is 0 missing weekdays (consecutive)", () => {
    const count = countWeekdaysBetween(new Date("2026-03-16"), new Date("2026-03-17"));
    expect(count).toBe(0);
  });
});

describe("detectGaps", () => {
  it("detects 3+ weekday gaps", async () => {
    // Insert rates with a gap: Mon 2026-03-09, then skip Tue-Thu, then Fri 2026-03-13
    await insertRate("2026-03-09", "EUR/SEK", "11.1");
    await insertRate("2026-03-13", "EUR/SEK", "11.2");

    const gaps = await detectGaps(
      {
        $queryRawUnsafe: (q: string, ...args: unknown[]) =>
          adminPool.query(q, args).then((r) => r.rows),
      },
      "EUR/SEK",
      "2026-03-01",
      "2026-03-31",
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0].from).toBe("2026-03-09");
    expect(gaps[0].to).toBe("2026-03-13");
    expect(gaps[0].missingWeekdays).toBe(3);
  });

  it("does not flag Friday→Monday as a gap", async () => {
    await insertRate("2026-03-13", "EUR/SEK", "11.1"); // Friday
    await insertRate("2026-03-16", "EUR/SEK", "11.2"); // Monday

    const gaps = await detectGaps(
      {
        $queryRawUnsafe: (q: string, ...args: unknown[]) =>
          adminPool.query(q, args).then((r) => r.rows),
      },
      "EUR/SEK",
      "2026-03-01",
      "2026-03-31",
    );

    expect(gaps).toHaveLength(0);
  });
});

describe("Decimal rate multiplication proof", () => {
  it("amount.times(rate) produces correct baseAmountSek", () => {
    const amount = new Prisma.Decimal("100.00");
    const rate = new Prisma.Decimal("11.234567");
    const result = amount.times(rate);

    expect(result.toString()).toBe("1123.4567");
  });

  it("small CHF amount times EUR/CHF rate", () => {
    const amount = new Prisma.Decimal("50.25");
    const rate = new Prisma.Decimal("0.9041");
    const result = amount.times(rate);

    // 50.25 * 0.9041 = 45.431025
    expect(result.toFixed(6)).toBe("45.431025");
  });

  it("negative amount preserves sign through multiplication", () => {
    const amount = new Prisma.Decimal("-226.66");
    const rate = new Prisma.Decimal("11.234567");
    const result = amount.times(rate);

    expect(result.isNegative()).toBe(true);
    // -226.66 * 11.234567 = -2546.43...
    expect(result.toFixed(2)).toBe("-2546.43");
  });
});
