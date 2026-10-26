// F94 SC-004 (specs/subscriptions): the expected dates and the price of a period — fixtures at the edges (month
// ends, leap years), then properties over generated subscriptions.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "@/kernel/clock/calendar";
import { expectedDates, nthDate, periodAt, periodsOf } from "./periods";

const isoDay = fc
  .date({
    min: new Date("2000-01-01T00:00:00.000Z"),
    max: new Date("2040-12-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

describe("expected dates (US2-1)", () => {
  it("monthly keeps the anchor's day, clamped to a shorter month, and the clamp never sticks", () => {
    expect(expectedDates("2026-01-31", "monthly", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(nthDate("2024-01-31", "monthly", 1)).toBe("2024-02-29"); // a leap year
    expect(expectedDates("2026-01-14", "monthly", "2026-04-13")).toEqual([
      "2026-01-14",
      "2026-02-14",
      "2026-03-14",
    ]);
  });
  it("yearly keeps day and month; 29 February falls on the 28th in a common year", () => {
    expect(expectedDates("2025-03-02", "yearly", "2028-03-02")).toEqual([
      "2025-03-02",
      "2026-03-02",
      "2027-03-02",
      "2028-03-02",
    ]);
    expect(expectedDates("2024-02-29", "yearly", "2028-12-31")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });
  it("crosses the year end and is empty before the start", () => {
    expect(expectedDates("2025-11-30", "monthly", "2026-02-01")).toEqual([
      "2025-11-30",
      "2025-12-30",
      "2026-01-30",
    ]);
    expect(expectedDates("2026-01-14", "monthly", "2026-01-13")).toEqual([]);
  });
});

describe("periodsOf (FR-004)", () => {
  const base = {
    startDate: "2026-01-14",
    endDate: null,
    cadence: "monthly" as const,
    prices: [
      { validFrom: "2026-01-14", validTo: "2026-09-13", amount: "20.00", currency: "EUR" },
      { validFrom: "2026-09-14", validTo: null, amount: "22.00", currency: "EUR" },
    ],
    pauses: [{ fromDate: "2026-07-01", toDate: "2026-08-31" }],
  };
  it("counts from the start (Q3 A) and stops one period after today", () => {
    const p = periodsOf(base, "2026-10-20");
    expect(p.map((x) => x.date)).toEqual([
      "2026-01-14",
      "2026-02-14",
      "2026-03-14",
      "2026-04-14",
      "2026-05-14",
      "2026-06-14",
      "2026-07-14",
      "2026-08-14",
      "2026-09-14",
      "2026-10-14",
      "2026-11-14",
    ]);
  });
  it("the price valid on the date (US5-1), the pause skips (US5-3), the windows", () => {
    const p = periodsOf(base, "2026-10-20");
    expect(p[7]).toMatchObject({ date: "2026-08-14", skipped: true, price: { amount: "20.00" } });
    expect(p[8]).toMatchObject({ date: "2026-09-14", skipped: false, price: { amount: "22.00" } });
    expect(p[9]?.rowWindow).toEqual({ from: "2026-10-11", to: "2026-10-21" });
    expect(p[9]?.receiptWindow).toEqual({ from: "2026-10-04", to: "2026-10-24" });
  });
  it("ends on the end date (US5-4) — nothing after it, even before today", () => {
    const p = periodsOf({ ...base, endDate: "2026-03-14" }, "2026-10-20");
    expect(p.map((x) => x.date)).toEqual(["2026-01-14", "2026-02-14", "2026-03-14"]);
  });
  it("no price before the first one: the period has a null price", () => {
    expect(periodAt({ ...base, prices: base.prices.slice(1) }, "2026-02-14").price).toBeNull();
  });
});

describe("properties (SC-004)", () => {
  const sub = fc.record({
    startDate: isoDay,
    cadence: fc.constantFrom("monthly" as const, "yearly" as const),
    endOffset: fc.option(fc.integer({ min: 0, max: 3000 }), { nil: null }),
    todayOffset: fc.integer({ min: -100, max: 4000 }),
  });

  it("every date lies between start and end; at most one beyond today; in order", () => {
    fc.assert(
      fc.property(sub, (s) => {
        const endDate = s.endOffset === null ? null : addDays(s.startDate, s.endOffset);
        const today = addDays(s.startDate, s.todayOffset);
        const p = periodsOf({ ...s, endDate, prices: [], pauses: [] }, today);
        for (const x of p) {
          expect(x.date >= s.startDate).toBe(true);
          if (endDate) expect(x.date <= endDate).toBe(true);
        }
        expect(p.filter((x) => x.date > today).length).toBeLessThanOrEqual(1);
        for (let i = 1; i < p.length; i++) expect(p[i]!.date > p[i - 1]!.date).toBe(true);
      }),
    );
  });

  it("monthly dates are one calendar month apart: 28–31 days, on the anchor day or its month's last", () => {
    fc.assert(
      fc.property(isoDay, fc.integer({ min: 1, max: 60 }), (start, n) => {
        const a = nthDate(start, "monthly", n - 1);
        const b = nthDate(start, "monthly", n);
        expect(daysBetween(a, b)).toBeGreaterThanOrEqual(28);
        expect(daysBetween(a, b)).toBeLessThanOrEqual(31);
        const anchor = Number(start.slice(8));
        const day = Number(b.slice(8));
        const [y, m] = b.split("-").map(Number) as [number, number];
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        expect(day).toBe(Math.min(anchor, last));
      }),
    );
  });

  it("a pause skips exactly the periods whose date falls in it", () => {
    fc.assert(
      fc.property(
        isoDay,
        fc.integer({ min: 0, max: 800 }),
        fc.integer({ min: 0, max: 200 }),
        (start, from, len) => {
          const pause = { fromDate: addDays(start, from), toDate: addDays(start, from + len) };
          const p = periodsOf(
            { startDate: start, endDate: null, cadence: "monthly", prices: [], pauses: [pause] },
            addDays(start, 1200),
          );
          for (const x of p)
            expect(x.skipped).toBe(x.date >= pause.fromDate && x.date <= pause.toDate);
        },
      ),
    );
  });
});
