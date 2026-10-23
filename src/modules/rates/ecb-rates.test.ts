import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATION_URL } from "@/kernel/db/test-setup";
import {
  buildEcbUrl,
  countWeekdaysBetween,
  fetchDailyRates,
  fetchRatesArgToOptions,
  getRate,
  NEAREST_RATE_MAX_DAYS,
  parseEcbXml,
  rateGaps,
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

describe("fetchRatesArgToOptions — the script argument", () => {
  const today = "2026-10-22";

  it("a past day backfills from it", () => {
    expect(fetchRatesArgToOptions("2023-04-01", today)).toEqual({ startDate: "2023-04-01" });
    expect(fetchRatesArgToOptions(today, today)).toEqual({ startDate: today });
  });

  it("a number keeps the last N, clamped to 1..2000; nothing means 400", () => {
    expect(fetchRatesArgToOptions("30", today)).toEqual({ lastN: 30 });
    expect(fetchRatesArgToOptions("0", today)).toEqual({ lastN: 1 });
    expect(fetchRatesArgToOptions("99999", today)).toEqual({ lastN: 2000 });
    expect(fetchRatesArgToOptions(undefined, today)).toEqual({ lastN: 400 });
  });

  it("rejects a future day, an impossible day and anything else", () => {
    expect(fetchRatesArgToOptions("2026-10-23", today)).toBeNull();
    expect(fetchRatesArgToOptions("2023-02-30", today)).toBeNull();
    expect(fetchRatesArgToOptions("2023-4-1", today)).toBeNull();
    expect(fetchRatesArgToOptions("april", today)).toBeNull();
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

  // The rate a missing day borrows is written once (D3) — the rule, not the query, is under test (lessons 7, 31).
  const db = {
    $queryRawUnsafe: (q: string, ...args: unknown[]) =>
      adminPool.query(q, args).then((r) => r.rows),
  };

  it("Sunday takes Friday, not the closer Monday; the requested date is kept", async () => {
    await insertRate("2026-03-13", "EUR/SEK", "11.111111"); // Fri
    await insertRate("2026-03-16", "EUR/SEK", "11.666666"); // Mon — 1 day away, Friday is 2

    const result = await getRate(db, "2026-03-15", "EUR/SEK");

    expect(result?.rateSource).toBe("ecb_nearest");
    expect(result?.actualDate).toBe("2026-03-13");
    expect(result?.rate.toString()).toBe("11.111111");
    expect(result?.date).toBe("2026-03-15");
  });

  it("a tie (mid-week holiday, Tuesday and Thursday both 1 day away) always takes the earlier day", async () => {
    await insertRate("2026-03-17", "EUR/SEK", "11.17"); // Tue
    await insertRate("2026-03-19", "EUR/SEK", "11.19"); // Thu

    for (let i = 0; i < 3; i++) {
      const result = await getRate(db, "2026-03-18", "EUR/SEK");
      expect(result?.actualDate).toBe("2026-03-17");
    }
  });

  it(`reaches ${NEAREST_RATE_MAX_DAYS} days back: Easter Monday takes Maundy Thursday over Tuesday`, async () => {
    expect(NEAREST_RATE_MAX_DAYS).toBe(4);
    await insertRate("2026-04-02", "EUR/SEK", "11.02"); // Thu before Easter (Good Friday is a TARGET closure)
    await insertRate("2026-04-07", "EUR/SEK", "11.07"); // Tue after Easter, 1 day away

    const result = await getRate(db, "2026-04-06", "EUR/SEK");

    expect(result?.actualDate).toBe("2026-04-02");
  });

  it("refuses a sync gap over the cap instead of guessing (null → the caller says run the ECB sync)", async () => {
    await insertRate("2026-03-02", "EUR/SEK", "11.02"); // 8 days before
    await insertRate("2026-03-20", "EUR/SEK", "11.20"); // 10 days after

    expect(await getRate(db, "2026-03-10", "EUR/SEK")).toBeNull();

    // one day past the cap, on either side
    await adminPool.query("TRUNCATE ecb_rates");
    await insertRate("2026-03-09", "EUR/SEK", "11.09"); // Mon, 5 days before Sat 03-14
    expect(await getRate(db, "2026-03-14", "EUR/SEK")).toBeNull();
    await insertRate("2026-03-19", "EUR/SEK", "11.19"); // Thu, 5 days after
    expect(await getRate(db, "2026-03-14", "EUR/SEK")).toBeNull();
  });

  it("takes a later day only when no earlier one is in reach (first day of the backfill)", async () => {
    await insertRate("2023-04-03", "EUR/SEK", "11.30"); // Mon; nothing stored before

    const result = await getRate(db, "2023-04-01", "EUR/SEK"); // Sat, the cut-off day

    expect(result?.rateSource).toBe("ecb_nearest");
    expect(result?.actualDate).toBe("2023-04-03");
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

describe("rateGaps — the warning matches the refusal, per pair (F81)", () => {
  const db = {
    $queryRawUnsafe: (q: string, ...args: unknown[]) =>
      adminPool.query(q, args).then((r) => r.rows),
  };

  it("an inner gap: 3+ weekdays between two stored days, each missing day named", async () => {
    await insertRate("2026-03-09", "EUR/SEK", "11.1"); // Mon
    await insertRate("2026-03-13", "EUR/SEK", "11.2"); // Fri — Tue, Wed, Thu missing

    const gaps = await rateGaps(db, "2026-03-13", { currencyPairs: ["EUR/SEK"] });

    expect(gaps).toEqual([
      {
        pair: "EUR/SEK",
        from: "2026-03-09",
        to: "2026-03-13",
        missingDays: ["2026-03-10", "2026-03-11", "2026-03-12"],
      },
    ]);
  });

  it("a weekend and a TARGET closure are not gaps (Fri → Mon; Easter: Thu → Tue)", async () => {
    await insertRate("2026-03-13", "EUR/SEK", "11.1"); // Fri
    await insertRate("2026-03-16", "EUR/SEK", "11.2"); // Mon
    await insertRate("2026-04-02", "EUR/SEK", "11.3"); // Maundy Thursday
    await insertRate("2026-04-07", "EUR/SEK", "11.4"); // Tuesday after Easter — Good Friday + Easter Monday

    expect(
      await rateGaps(db, "2026-04-07", { currencyPairs: ["EUR/SEK"], windowDays: 40 }),
    ).toEqual([
      // the 13 weekdays between 03-16 and 04-02 are a real gap; the two around Easter are not
      expect.objectContaining({ from: "2026-03-16", to: "2026-04-02" }),
    ]);
  });

  it("the trailing gap shows from the day the newest rate is 4 days old — the day before getRate refuses", async () => {
    await insertRate("2026-03-13", "EUR/CHF", "0.95"); // Fri, then no sync
    for (const day of ["2026-03-13", "2026-03-16", "2026-03-17", "2026-03-18"])
      await insertRate(day, "EUR/SEK", "11.3"); // SEK current: CHF's gap shows on its own
    const chf = (today: string) => rateGaps(db, today, { currencyPairs: ["EUR/SEK", "EUR/CHF"] });

    // Mon: 3 days — the normal weekend, nothing
    expect(await chf("2026-03-16")).toEqual([]);
    // Tue: 4 days — still borrowed today, refused tomorrow → the gap shows
    expect(await chf("2026-03-17")).toEqual([
      { pair: "EUR/CHF", from: "2026-03-13", to: null, missingDays: ["2026-03-16"] },
    ]);
    expect((await getRate(db, "2026-03-17", "EUR/CHF"))?.actualDate).toBe("2026-03-13");
    // Wed: 5 days — refused, and the gap says so
    expect(await chf("2026-03-18")).toEqual([
      { pair: "EUR/CHF", from: "2026-03-13", to: null, missingDays: ["2026-03-16", "2026-03-17"] },
    ]);
    expect(await getRate(db, "2026-03-18", "EUR/CHF")).toBeNull();
  });

  it("a pair never stored is one trailing gap over the window; a gap begun before the window is clipped to it", async () => {
    expect(await rateGaps(db, "2026-03-18", { currencyPairs: ["EUR/USD"], windowDays: 7 })).toEqual(
      [
        {
          pair: "EUR/USD",
          from: null,
          to: null,
          missingDays: ["2026-03-11", "2026-03-12", "2026-03-13", "2026-03-16", "2026-03-17"],
        },
      ],
    );

    await insertRate("2026-01-30", "EUR/SEK", "11.1"); // before the window
    await insertRate("2026-03-13", "EUR/SEK", "11.2");
    const [gap] = await rateGaps(db, "2026-03-13", { currencyPairs: ["EUR/SEK"] }); // window from 02-11
    expect(gap).toMatchObject({ from: "2026-01-30", to: "2026-03-13" });
    expect(gap.missingDays[0]).toBe("2026-02-11");
    expect(gap.missingDays).toHaveLength(22); // the weekdays 02-11 … 03-12
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

  it("a backfill over a stored day: the new days inserted, the stored one skipped and unchanged (V8)", async () => {
    await insertRate("2026-03-13", "EUR/SEK", "11.111111");
    const obs = (day: string, rate: string) =>
      `<generic:Obs><generic:ObsDimension value="${day}"/><generic:ObsValue value="${rate}"/></generic:Obs>`;
    const threeDays = MOCK_XML.replace(
      /<generic:Obs>[\s\S]*<\/generic:Obs>/,
      obs("2026-03-12", "11.12") + obs("2026-03-13", "99.99") + obs("2026-03-16", "11.16"),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(threeDays, { status: 200 }));
    const prisma = {
      $executeRawUnsafe: async (q: string, ...args: unknown[]) => {
        await adminPool.query(q, args);
        return 1;
      },
    };

    const result = await fetchDailyRates(prisma, {
      startDate: "2026-03-12",
      currencyPairs: ["EUR/SEK"],
    });

    expect(result).toMatchObject({ inserted: 2, skipped: 1 });
    const { rows } = await adminPool.query(
      `SELECT date::text, rate::text FROM ecb_rates WHERE currency_pair = 'EUR/SEK' ORDER BY date`,
    );
    expect(rows).toEqual([
      { date: "2026-03-12", rate: "11.120000" },
      { date: "2026-03-13", rate: "11.111111" },
      { date: "2026-03-16", rate: "11.160000" },
    ]);

    vi.restoreAllMocks();
  });

  it("backfills from startDate: startPeriod only, no endPeriod, no lastN cap", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(MOCK_XML, { status: 200 }));
    const prisma = { $executeRawUnsafe: vi.fn().mockResolvedValue(1) };

    await fetchDailyRates(prisma, { startDate: "2023-04-01", currencyPairs: ["EUR/SEK"] });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("startPeriod=2023-04-01");
    expect(url).not.toContain("endPeriod");
    expect(url).not.toContain("lastNObservations");

    vi.restoreAllMocks();
  });

  it("without date or startDate fetches only the latest observation", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(MOCK_XML, { status: 200 }));
    const prisma = { $executeRawUnsafe: vi.fn().mockResolvedValue(1) };

    await fetchDailyRates(prisma, { currencyPairs: ["EUR/SEK"] });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("lastNObservations=1");
    expect(url).not.toContain("startPeriod");

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

  it("both legs borrowed, on different days: the earlier day is named (T004)", async () => {
    await insertRate("2026-01-30", "EUR/SEK", "11.1000"); // Fri
    await insertRate("2026-01-29", "EUR/CHF", "0.9260"); // Thu — CHF a day behind
    const r = await rateToBase(db, "2026-01-31", "CHF", "SEK"); // Sat
    expect(r?.source).toBe("ecb_nearest");
    expect(r?.rateDate).toBe("2026-01-29");
    const reverse = await rateToBase(db, "2026-01-31", "SEK", "CHF");
    expect(reverse?.rateDate).toBe("2026-01-29");
  });

  it("null when a leg's nearest day is past the cap — never a weeks-old rate written once", async () => {
    await insertRate("2026-01-30", "EUR/SEK", "11.1000");
    await insertRate("2026-01-30", "EUR/CHF", "0.9260");
    await insertRate("2026-02-10", "EUR/SEK", "11.2000"); // SEK leg on the day, CHF leg 11 days old
    expect(await rateToBase(db, "2026-02-10", "CHF", "SEK")).toBeNull();
    expect((await rateToBase(db, "2026-02-10", "EUR", "SEK"))?.source).toBe("ecb_daily");
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
