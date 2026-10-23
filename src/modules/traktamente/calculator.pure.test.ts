// The per-diem calculator on the harvest's fixtures (specs/traktamente SC-001, SC-002): every day-count case on
// the v3 column, the worked examples of meal-reductions.json, the boundaries, DST, two rate years, a property.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import {
  computePerDiem,
  countDays,
  nextDate,
  PerDiemError,
  perDiemDescription,
  perDiemNote,
  toLocal,
} from "./calculator";
import type { RateRow } from "./types";

const FIXTURES = join(__dirname, "..", "..", "..", "specs", "traktamente", "fixtures");
const json = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const D = Prisma.Decimal;

const CH: RateRow = {
  year: 2025,
  countryCode: "CH",
  dayAmount: "1402",
  nightAmount: null,
  mealBreakfast: null,
  mealLunch: null,
  mealDinner: null,
  mealAll: null,
};
const SE: RateRow = {
  year: 2025,
  countryCode: "SE",
  dayAmount: "290",
  nightAmount: "145",
  mealBreakfast: "58",
  mealLunch: "102",
  mealDinner: "102",
  mealAll: "261",
};
const rates = (...rows: RateRow[]) => new Map(rows.map((r) => [r.year, r]));
const trip = (over: Partial<Parameters<typeof computePerDiem>[0]>) => ({
  departureAt: "2026-03-09T07:00",
  returnAt: "2026-03-11T21:00",
  countryCode: "CH",
  breakfasts: 0,
  lunches: 0,
  dinners: 0,
  nightsWithoutPaidLodging: 0,
  ...over,
});
const forYears = (row: RateRow, ...years: number[]) =>
  rates(...years.map((year) => ({ ...row, year })));

describe("countDays — day-count-cases.json, the v3 column (US1)", () => {
  const cases = json("day-count-cases.json").cases as {
    id: string;
    departure: string;
    return: string;
    v3: Record<string, unknown>;
  }[];
  for (const c of cases) {
    it(c.id, () => {
      if (c.v3.error) {
        expect(() => countDays(c.departure, c.return)).toThrow(String(c.v3.error));
        return;
      }
      const r = countDays(c.departure, c.return);
      expect(r.fullDays).toBe(c.v3.full_days);
      expect(r.halfDays).toBe(c.v3.half_days);
      expect(r.nights).toBe(c.v3.overnights);
      expect(r.days).toBe(c.v3.days);
      expect(r.reason).toBe(c.v3.reason ?? null);
      if (c.v3.days_per_year) {
        const perYear: Record<string, number> = {};
        for (const d of r.perDay) perYear[d.year] = (perYear[d.year] ?? 0) + 1;
        expect(perYear).toEqual(c.v3.days_per_year);
      }
    });
  }

  it("the boundaries: 11:59 full / 12:00 half on departure, 19:00 half / 19:01 full on return", () => {
    expect(countDays("2026-03-09T11:59", "2026-03-10T21:00").perDay[0].kind).toBe("full");
    expect(countDays("2026-03-09T12:00", "2026-03-10T21:00").perDay[0].kind).toBe("half");
    expect(countDays("2026-03-09T08:00", "2026-03-10T19:00").perDay[1].kind).toBe("half");
    expect(countDays("2026-03-09T08:00", "2026-03-10T19:01").perDay[1].kind).toBe("full");
  });

  it("instants are read in the tenant zone (Stockholm), not UTC", () => {
    // 2026-03-09 23:30 UTC = 00:30 Stockholm on the 10th
    expect(toLocal(new Date("2026-03-09T23:30:00Z"))).toEqual({ date: "2026-03-10", minutes: 30 });
    // summer: 10:30 UTC = 12:30 Stockholm → a half departure day
    const r = countDays(new Date("2026-07-01T10:30:00Z"), new Date("2026-07-02T20:00:00Z"));
    expect(r.perDay.map((d) => d.kind)).toEqual(["half", "full"]);
    expect(nextDate("2026-10-25")).toBe("2026-10-26");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
    expect(() => countDays("2026-03-10T10:00", "2026-03-10T09:00")).toThrow(/after the departure/);
  });
});

describe("computePerDiem — the amount (US2, meal-reductions.json)", () => {
  it("CH 3 full days, no meals → 4 206.00; with 2 lunches → 3 224.60", () => {
    const r = computePerDiem(trip({}), forYears(CH, 2026));
    expect(r).toMatchObject({
      fullDays: 3,
      halfDays: 0,
      days: 3,
      dayTotal: "4206.00",
      total: "4206.00",
    });
    const l = computePerDiem(trip({ lunches: 2 }), forYears(CH, 2026));
    expect(l.meals.deduction).toBe("981.40");
    expect(l.total).toBe("3224.60");
  });

  it("the owner's 19.5-day trip with 18 lunches → 27 339.00 − 8 832.60 = 18 506.40 (the Excel's Meal Allowance row)", () => {
    const r = computePerDiem(
      trip({ departureAt: "2026-03-02T09:00", returnAt: "2026-03-21T17:00", lunches: 18 }),
      forYears(CH, 2026),
    );
    expect(r).toMatchObject({
      fullDays: 19,
      halfDays: 1,
      days: 19.5,
      nights: 19,
      dayTotal: "27339.00",
      total: "18506.40",
    });
    expect(r.meals.deduction).toBe("8832.60");
    expect(perDiemDescription(r)).toBe("Traktamente CH 19.5 days");
    expect(perDiemNote(r)).toContain("19 full day(s) + 1 half day(s) = 19.5 days, 19 night(s)");
    expect(perDiemNote(r)).toContain("Total 18506.40 SEK");
  });

  it("a half day with all three meals abroad: 85 % of the full day amount is deducted (counts, not days)", () => {
    const r = computePerDiem(
      trip({
        departureAt: "2026-03-09T14:00",
        returnAt: "2026-03-10T21:00",
        breakfasts: 1,
        lunches: 1,
        dinners: 1,
      }),
      forYears(CH, 2026),
    );
    expect(r.perDay.map((d) => d.amount)).toEqual(["701.00", "1402.00"]);
    expect(r.meals.deduction).toBe("1191.70");
    expect(r.total).toBe("911.30");
  });

  it("Sweden: fixed krona amounts, triples at 261, nights without paid lodging at 145 → 899.00", () => {
    const r = computePerDiem(
      trip({
        countryCode: "SE",
        breakfasts: 1,
        lunches: 1,
        dinners: 1,
        nightsWithoutPaidLodging: 2,
      }),
      forYears(SE, 2026),
    );
    expect(r).toMatchObject({ dayTotal: "870.00", total: "899.00" });
    expect(r.meals.deduction).toBe("261.00");
    expect(r.nightAllowance).toEqual({ nights: 2, nightAmount: "145.00", total: "290.00" });
    const singles = computePerDiem(
      trip({ countryCode: "SE", breakfasts: 2, lunches: 1 }),
      forYears(SE, 2026),
    );
    expect(singles.meals.deduction).toBe("218.00"); // 2 × 58 + 102
    const noAmounts = forYears({ ...SE, mealAll: null }, 2026);
    expect(() => computePerDiem(trip({ countryCode: "SE", lunches: 1 }), noAmounts)).toThrow(
      /meal amounts/,
    );
    // abroad the night amount defaults to half the day amount
    const ch = computePerDiem(trip({ nightsWithoutPaidLodging: 1 }), forYears(CH, 2026));
    expect(ch.nightAllowance).toEqual({ nights: 1, nightAmount: "701.00", total: "701.00" });
  });

  it("a same-day trip is nothing; counts above the trip are refused; a missing year names the year", () => {
    const none = computePerDiem(
      trip({ departureAt: "2026-03-10T08:00", returnAt: "2026-03-10T17:00" }),
      forYears(CH, 2026),
    );
    expect(none).toMatchObject({ days: 0, total: "0.00", reason: "no overnight stay" });
    expect(() => computePerDiem(trip({ lunches: 4 }), forYears(CH, 2026))).toThrow(
      /Lunches \(4\) exceed the 3 days/,
    );
    expect(() => computePerDiem(trip({ nightsWithoutPaidLodging: 3 }), forYears(CH, 2026))).toThrow(
      /exceed the 2 nights/,
    );
    expect(() => computePerDiem(trip({}), forYears(CH, 2025))).toThrow(
      "No travel allowance rate for CH in 2026",
    );
    expect(() => computePerDiem(trip({ longStayFactor: "1.5" }), forYears(CH, 2026))).toThrow(
      /between 0 and 1/,
    );
  });

  it("every refusal carries its rule and the facts a screen renders in its own language (T003)", () => {
    const details = (run: () => unknown) => {
      try {
        run();
      } catch (e) {
        expect(e).toBeInstanceOf(PerDiemError);
        return (e as PerDiemError).details;
      }
      throw new Error("expected a refusal");
    };
    expect(details(() => computePerDiem(trip({}), forYears(CH, 2025)))).toEqual({
      rule: "missing_rate",
      countryCode: "CH",
      year: 2026,
    });
    expect(details(() => computePerDiem(trip({ lunches: 4 }), forYears(CH, 2026)))).toEqual({
      rule: "too_many_meals",
      meal: "lunches",
      count: 4,
      days: 3,
    });
    expect(
      details(() => computePerDiem(trip({ nightsWithoutPaidLodging: 3 }), forYears(CH, 2026))),
    ).toEqual({ rule: "too_many_nights", count: 3, nights: 2 });
    expect(
      details(() => computePerDiem(trip({ longStayFactor: "1.5" }), forYears(CH, 2026))),
    ).toEqual({ rule: "long_stay" });
  });

  it("two rate years: each day at its own year's amount, flagged; meals at the departure year", () => {
    const r = computePerDiem(
      trip({ departureAt: "2025-12-30T08:00", returnAt: "2026-01-02T21:00", lunches: 1 }),
      rates({ ...CH, year: 2025, dayAmount: "1400" }, { ...CH, year: 2026, dayAmount: "1500" }),
    );
    expect(r.rateYears).toEqual([2025, 2026]);
    expect(r.perDay.map((d) => d.amount)).toEqual(["1400.00", "1400.00", "1500.00", "1500.00"]);
    expect(r.dayTotal).toBe("5800.00");
    expect(r.mealRateYear).toBe(2025);
    expect(r.meals.deduction).toBe("490.00");
    expect(r.warnings).toEqual([
      {
        type: "two_rate_years",
        message: "trip spans two rate years (2025, 2026)",
        years: "2025, 2026",
      },
    ]);
  });

  it("long stay: the factor applies to the day amounts and the abroad meal base", () => {
    const r = computePerDiem(trip({ longStayFactor: "0.7", lunches: 1 }), forYears(CH, 2026));
    expect(r.perDay[0].amount).toBe("981.40");
    expect(r.meals.deduction).toBe("343.49");
    expect(r.total).toBe("2600.71");
  });
});

describe("property (SC-002)", () => {
  const dayMinutes = fc.integer({ min: 0, max: 23 * 60 + 59 });
  const dayOffset = fc.integer({ min: 0, max: 40 });
  const start = fc.integer({ min: 0, max: 300 });

  it("days = full + 0.5 × half, nights = calendar days − 1, total ≥ 0 and ≤ Σ day amounts + nights", () => {
    fc.assert(
      fc.property(
        start,
        dayOffset,
        dayMinutes,
        dayMinutes,
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        (s, offset, depMin, retMin, b, l, d) => {
          const base = new Date(Date.UTC(2026, 0, 1 + s));
          const depDate = base.toISOString().slice(0, 10);
          const retDate = new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
          const hhmm = (m: number) =>
            `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const departureAt = `${depDate}T${hhmm(depMin)}`;
          const returnAt = `${retDate}T${hhmm(retMin)}`;
          fc.pre(returnAt > departureAt);
          const count = countDays(departureAt, returnAt);
          expect(count.days).toBe(count.fullDays + count.halfDays / 2);
          if (count.perDay.length === 0) {
            expect(count.reason).toBe("no overnight stay");
            return;
          }
          expect(count.nights).toBe(count.perDay.length - 1);
          const t = trip({
            departureAt,
            returnAt,
            breakfasts: Math.min(b, count.perDay.length),
            lunches: Math.min(l, count.perDay.length),
            dinners: Math.min(d, count.perDay.length),
          });
          const r = computePerDiem(t, forYears(CH, 2025, 2026, 2027));
          expect(new D(r.total).gte(0)).toBe(true);
          expect(new D(r.total).lte(r.dayTotal)).toBe(true);
          expect(new D(r.dayTotal).toFixed(2)).toBe(
            new D(count.fullDays).mul(1402).plus(new D(count.halfDays).mul(701)).toFixed(2),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
