import { describe, expect, it } from "vitest";
import { crossSeries, monthCoverage } from "./history";

// Invented rates (D51). 1 EUR = 11 SEK, 0.95 CHF, 1.10 USD → 1 CHF = 11 / 0.95 SEK.
const rows = [
  { date: "2026-07-01", pair: "EUR/SEK", rate: "11.000000" },
  { date: "2026-07-01", pair: "EUR/CHF", rate: "0.950000" },
  { date: "2026-07-01", pair: "EUR/USD", rate: "1.100000" },
  { date: "2026-07-02", pair: "EUR/SEK", rate: "11.200000" },
  { date: "2026-07-02", pair: "EUR/USD", rate: "1.120000" },
  // CHF missing on 07-02: no CHF point that day
];

describe("crossSeries — one series per currency against the base (FR-011)", () => {
  it("crosses through EUR, 6 dp half-up, EUR itself a leg of 1, the base left out", () => {
    const s = crossSeries(rows, "SEK", ["SEK", "CHF", "EUR", "USD"]);
    expect(s.map((x) => x.currency)).toEqual(["CHF", "EUR", "USD"]);
    expect(s[0]?.points).toEqual([{ date: "2026-07-01", rate: "11.578947" }]); // 11 / 0.95
    expect(s[1]?.points).toEqual([
      { date: "2026-07-01", rate: "11.000000" },
      { date: "2026-07-02", rate: "11.200000" },
    ]);
    expect(s[2]?.points.map((p) => p.rate)).toEqual(["10.000000", "10.000000"]); // 11/1.1, 11.2/1.12
  });

  it("another base: the same rows read against CHF", () => {
    const s = crossSeries(rows, "CHF", ["SEK", "CHF", "EUR"]);
    expect(s.map((x) => x.currency)).toEqual(["SEK", "EUR"]);
    expect(s[0]?.points).toEqual([{ date: "2026-07-01", rate: "0.086364" }]); // 0.95 / 11
    expect(s[1]?.points).toEqual([{ date: "2026-07-01", rate: "0.950000" }]);
  });

  it("no rows: empty series, never a guess", () => {
    expect(crossSeries([], "SEK", ["SEK", "CHF"])).toEqual([{ currency: "CHF", points: [] }]);
  });
});

describe("monthCoverage — the months, their weekdays and missing days (FR-012)", () => {
  it("from the first month to today's, weekdays up to today, missing counted per month", () => {
    const m = monthCoverage("2026-08-12", "2026-10-07", ["2026-09-01", "2026-09-02", "2026-10-06"]);
    expect(m).toEqual([
      { month: "2026-08", weekdays: 21, missing: 0, beforeFirst: false },
      { month: "2026-09", weekdays: 22, missing: 2, beforeFirst: false },
      // 2026-10-01 is a Thursday: Thu, Fri, Mon, Tue, Wed = 5 weekdays up to the 7th
      { month: "2026-10", weekdays: 5, missing: 1, beforeFirst: false },
    ]);
  });

  it("from January of the first year: the months before the first rate say so, nothing missing there", () => {
    const m = monthCoverage("2026-03-04", "2026-03-31", [], { from: "2026-01" });
    expect(m.map((x) => [x.month, x.beforeFirst])).toEqual([
      ["2026-01", true],
      ["2026-02", true],
      ["2026-03", false],
    ]);
  });

  it("an empty table: this month only, before the first rate", () => {
    expect(monthCoverage(null, "2026-11-08", [])).toEqual([
      { month: "2026-11", weekdays: 5, missing: 0, beforeFirst: true },
    ]);
  });

  it("a missing day counted once even when every pair misses it", () => {
    const m = monthCoverage("2026-09-01", "2026-09-30", ["2026-09-15", "2026-09-15"]);
    expect(m[0]?.missing).toBe(1);
  });
});
