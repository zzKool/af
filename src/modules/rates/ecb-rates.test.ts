import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { MIGRATION_URL } from "@/kernel/db/test-setup";
import {
  buildEcbUrl,
  countWeekdaysBetween,
  detectGaps,
  fetchDailyRates,
  getRate,
  parseEcbXml,
  rateStatus,
  rateToBase,
} from "@/modules/rates/ecb-rates";

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

describe("fetchDailyRates", () => {
  const MOCK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<message:GenericData xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message" xmlns:generic="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic">
<message:DataSet>
<generic:Series>
<generic:SeriesKey>
<generic:Value id="CURRENCY" value="SEK"/>
</generic:SeriesKey>
<generic:Obs>
<generic:ObsDimension value="2026-03-14"/>
<generic:ObsValue value="11.2345"/>
</generic:Obs>
</generic:Series>
</message:DataSet>
</message:GenericData>`;

  it("fetches XML, parses, and inserts rates into DB", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(MOCK_XML, { status: 200, headers: { "Content-Type": "application/xml" } }),
    );

    // Delegate to real DB via adminPool (mimics Prisma.$executeRawUnsafe)
    const prisma = {
      $executeRawUnsafe: async (q: string, ...args: unknown[]) => {
        await adminPool.query(q, args);
        return 1;
      },
    };

    const result = await fetchDailyRates(prisma, {
      date: "2026-03-14",
      currencyPairs: ["EUR/SEK"],
    });

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.rates).toHaveLength(1);
    expect(result.rates[0].currencyPair).toBe("EUR/SEK");
    expect(result.rates[0].rate.toString()).toBe("11.2345");

    // Verify actually persisted in DB
    const { rows } = await adminPool.query(
      `SELECT rate::text FROM ecb_rates WHERE date = '2026-03-14' AND currency_pair = 'EUR/SEK'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rate).toBe("11.234500");

    vi.restoreAllMocks();
  });

  it("skips duplicate rates gracefully (unique constraint catch)", async () => {
    await insertRate("2026-03-14", "EUR/SEK", "11.2345");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(MOCK_XML, { status: 200, headers: { "Content-Type": "application/xml" } }),
    );

    // Real DB will throw unique constraint error — service should catch it
    const prisma = {
      $executeRawUnsafe: async (q: string, ...args: unknown[]) => {
        await adminPool.query(q, args);
        return 1;
      },
    };

    const result = await fetchDailyRates(prisma, {
      date: "2026-03-14",
      currencyPairs: ["EUR/SEK"],
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);

    vi.restoreAllMocks();
  });

  it("throws on non-OK HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" }),
    );

    const prisma = { $executeRawUnsafe: vi.fn() };

    await expect(
      fetchDailyRates(prisma, { date: "2026-03-14", currencyPairs: ["EUR/SEK"] }),
    ).rejects.toThrow("ECB API error: 503 Service Unavailable");

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();

    vi.restoreAllMocks();
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

describe("rateToBase — the conversion written once at issue (D3/D4)", () => {
  const db = {
    $queryRawUnsafe: (q: string, ...a: unknown[]) => adminPool.query(q, a).then((r) => r.rows),
  };

  it("same currency → 1, same_currency", async () => {
    const r = await rateToBase(db, "2026-01-31", "SEK", "SEK");
    expect(r?.rate.toString()).toBe("1");
    expect(r?.source).toBe("same_currency");
  });

  it("CHF → SEK crosses through EUR on the exact day", async () => {
    await insertRate("2026-01-30", "EUR/SEK", "11.1000");
    await insertRate("2026-01-30", "EUR/CHF", "0.9260");
    const r = await rateToBase(db, "2026-01-30", "CHF", "SEK");
    expect(r?.source).toBe("ecb_daily");
    expect(r?.rateDate).toBe("2026-01-30");
    expect(r?.rate.toFixed(6)).toBe("11.987041"); // 11.1 / 0.926
    const eur = await rateToBase(db, "2026-01-30", "EUR", "SEK");
    expect(eur?.rate.toFixed(4)).toBe("11.1000");
    const toEur = await rateToBase(db, "2026-01-30", "SEK", "EUR");
    expect(toEur?.rate.toFixed(6)).toBe("0.090090");
  });

  it("falls back to the nearest cached day (weekend issue date) and says so; null when a leg is missing", async () => {
    await insertRate("2026-01-30", "EUR/SEK", "11.1000");
    await insertRate("2026-01-30", "EUR/CHF", "0.9260");
    const weekend = await rateToBase(db, "2026-01-31", "CHF", "SEK");
    expect(weekend?.source).toBe("ecb_nearest");
    expect(weekend?.rateDate).toBe("2026-01-30");
    expect(await rateToBase(db, "2026-01-31", "USD", "SEK")).toBeNull();
  });
});

describe("rateStatus — Settings → Exchange rates", () => {
  const db = {
    $queryRawUnsafe: (q: string, ...args: unknown[]) =>
      adminPool.query(q, args).then((r) => r.rows),
  };

  it("reports the newest day, its rate and the missing weekdays of the window per pair", async () => {
    // today is Fri 2026-03-20; the window is the 30 days before, settled two days back (Wed 2026-03-18)
    // → 21 ECB weekdays from Wed 2026-02-18 to Wed 2026-03-18
    await insertRate("2026-03-16", "EUR/SEK", "11.10");
    await insertRate("2026-03-17", "EUR/SEK", "11.20");
    await insertRate("2026-03-18", "EUR/SEK", "11.30");
    await insertRate("2026-03-18", "EUR/CHF", "0.95");
    await insertRate("2026-01-05", "EUR/USD", "1.03"); // outside the window: newest day, no coverage

    const status = await rateStatus(db, "2026-03-20");
    expect(status.map((s) => s.pair)).toEqual(["EUR/SEK", "EUR/CHF", "EUR/USD"]);
    expect(status[0]).toEqual({
      pair: "EUR/SEK",
      latestDate: "2026-03-18",
      latestRate: "11.300000",
      storedDays: 3,
      missingWeekdays: 18,
    });
    expect(status[1]).toMatchObject({
      latestDate: "2026-03-18",
      storedDays: 1,
      missingWeekdays: 20,
    });
    expect(status[2]).toMatchObject({
      latestDate: "2026-01-05",
      latestRate: "1.030000",
      storedDays: 0,
      missingWeekdays: 21,
    });
  });

  it("an empty table: never fetched, every weekday missing; a full window is complete", async () => {
    const empty = await rateStatus(db, "2026-03-20");
    expect(empty.every((s) => s.latestDate === null && s.missingWeekdays === 21)).toBe(true);

    const d = new Date("2026-02-18");
    while (d <= new Date("2026-03-18")) {
      const day = d.getDay();
      if (day !== 0 && day !== 6)
        await insertRate(d.toISOString().slice(0, 10), "EUR/SEK", "11.00");
      d.setDate(d.getDate() + 1);
    }
    const full = await rateStatus(db, "2026-03-20", { currencyPairs: ["EUR/SEK"] });
    expect(full[0]).toMatchObject({ storedDays: 21, missingWeekdays: 0 });
  });
});
