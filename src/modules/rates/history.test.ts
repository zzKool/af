import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_URL } from "@/kernel/db/test-setup";
import { rateCoverage, rateHistory, ratesOnDay } from "@/modules/rates/history";

// The rates page's reads on the table (F136): invented rates (D51); ecb_rates is global, no RLS.
let adminPool: Pool;
const db = {
  $queryRawUnsafe: (q: string, ...args: unknown[]) => adminPool.query(q, args).then((r) => r.rows),
};

beforeAll(async () => {
  adminPool = new Pool({ connectionString: MIGRATION_URL });
});
beforeEach(async () => {
  await adminPool.query("TRUNCATE ecb_rates");
});
afterAll(async () => {
  await adminPool.end();
});

async function day(date: string, sek: string, chf: string, usd: string) {
  for (const [pair, rate] of [
    ["EUR/SEK", sek],
    ["EUR/CHF", chf],
    ["EUR/USD", usd],
  ])
    await adminPool.query("INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, $2, $3)", [
      date,
      pair,
      rate,
    ]);
}

describe("rateHistory · rateCoverage · ratesOnDay (FR-011 – FR-013)", () => {
  it("rateHistory: the fetched pairs between two days, both ends in, oldest first", async () => {
    await day("2026-07-01", "11.0", "0.95", "1.10");
    await day("2026-07-02", "11.2", "0.96", "1.12");
    await day("2026-07-03", "11.4", "0.97", "1.14");
    const rows = await rateHistory(db, "2026-07-02", "2026-07-03");
    expect(rows.map((r) => `${r.date} ${r.pair}`)).toEqual([
      "2026-07-02 EUR/CHF",
      "2026-07-02 EUR/SEK",
      "2026-07-02 EUR/USD",
      "2026-07-03 EUR/CHF",
      "2026-07-03 EUR/SEK",
      "2026-07-03 EUR/USD",
    ]);
  });

  it("rateCoverage: the missing days are the gaps' (a run not done), not a weekend; from January of the first year", async () => {
    // Mon 2026-07-06 … Fri 07-10 stored, then nothing until Fri 07-24: Mon 13 – Thu 23 missing (9 weekdays)
    for (const d of ["06", "07", "08", "09", "10", "24"])
      await day(`2026-07-${d}`, "11", "0.95", "1.1");
    const c = await rateCoverage(db, "2026-07-24");
    expect(c.first).toBe("2026-07-06");
    expect(c.missingDays).toHaveLength(9);
    expect(c.missingDays[0]).toBe("2026-07-13");
    expect(c.months[0]).toMatchObject({ month: "2026-01", beforeFirst: true, missing: 0 });
    expect(c.months.at(-1)).toMatchObject({ month: "2026-07", beforeFirst: false, missing: 9 });
  });

  it("ratesOnDay: a Sunday takes Friday's rate and says so; the base left out", async () => {
    await day("2026-07-10", "11.0", "0.95", "1.10"); // Fri
    const r = await ratesOnDay(db, "2026-07-12", "SEK", ["SEK", "CHF", "EUR", "USD"]);
    expect(r.map((x) => x.currency)).toEqual(["CHF", "EUR", "USD"]);
    expect(r[0]).toEqual({
      currency: "CHF",
      rate: "11.578947",
      source: "ecb_nearest",
      rateDate: "2026-07-10",
    });
    expect(r[1]?.rate).toBe("11.000000");
  });

  it("ratesOnDay: nothing within the cap → null, never a guess", async () => {
    await day("2026-07-01", "11.0", "0.95", "1.10");
    const r = await ratesOnDay(db, "2026-07-20", "SEK", ["SEK", "CHF"]);
    expect(r).toEqual([{ currency: "CHF", rate: null, source: null, rateDate: null }]);
  });
});
