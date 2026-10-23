// Calendar-day arithmetic on ISO days: fixtures at the edges (month ends, leap years, the DST weekends — which
// must not matter), then the identities between addDays, daysUntil and daysBetween as properties.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, daysBetween, daysUntil } from "./calendar";

/** An ISO day between 1990 and 2100 — the span covers leap years and the 2100 non-leap year. */
const isoDay = fc
  .date({
    min: new Date("1990-01-01T00:00:00.000Z"),
    max: new Date("2100-12-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));
const days = fc.integer({ min: -4000, max: 4000 });

describe("addDays", () => {
  it("crosses month ends, year ends and leap days on the calendar", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addDays("2026-03-21", 30)).toBe("2026-04-20"); // invoice date + default terms
    expect(addDays("2026-05-05", 0)).toBe("2026-05-05");
  });

  it("is not shifted by the DST weekends (Europe/Stockholm, 2026-03-29 and 2026-10-25)", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("refuses what is not an ISO day", () => {
    expect(() => addDays("21.03.2026", 1)).toThrow(/ISO date/);
    expect(() => addDays("2026-03-21T10:00:00Z", 1)).toThrow(/ISO date/);
    expect(() => addDays("2026-13-01", 1)).toThrow(/ISO date/);
  });

  it("property: n then −n is the same day; steps compose", () => {
    fc.assert(
      fc.property(isoDay, days, days, (d, n, m) => {
        expect(addDays(addDays(d, n), -n)).toBe(d);
        expect(addDays(addDays(d, n), m)).toBe(addDays(d, n + m));
      }),
      { numRuns: 300 },
    );
  });
});

describe("daysUntil / daysBetween", () => {
  it("count calendar days, signed and unsigned", () => {
    expect(daysUntil("2026-03-28", "2026-03-30")).toBe(2); // across the spring DST change
    expect(daysUntil("2026-03-30", "2026-03-28")).toBe(-2);
    expect(daysBetween("2026-03-30", "2026-03-28")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2); // across the autumn one
    expect(daysUntil("2024-02-01", "2024-03-01")).toBe(29);
    expect(daysUntil("2023-02-01", "2023-03-01")).toBe(28);
    expect(daysUntil("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-05-05", "2026-05-05")).toBe(0);
    expect(() => daysUntil("2026-05-05", "5/5/2026")).toThrow(/ISO date/);
  });

  it("property: daysUntil inverts addDays; daysBetween is its absolute value, symmetric", () => {
    fc.assert(
      fc.property(isoDay, days, (d, n) => {
        const e = addDays(d, n);
        expect(daysUntil(d, e)).toBe(n);
        expect(daysUntil(e, d)).toBe(0 - n); // 0 − n, not −n: −0 is not 0 for toBe
        expect(daysBetween(d, e)).toBe(Math.abs(n));
        expect(daysBetween(e, d)).toBe(daysBetween(d, e));
      }),
      { numRuns: 300 },
    );
  });

  it("property: signed days add up along the calendar; the sign follows the ISO string order", () => {
    fc.assert(
      fc.property(isoDay, isoDay, isoDay, (a, b, c) => {
        expect(daysUntil(a, c)).toBe(daysUntil(a, b) + daysUntil(b, c));
        expect(Math.sign(daysUntil(a, b))).toBe(a < b ? 1 : a > b ? -1 : 0);
        expect(addDays(a, daysUntil(a, b))).toBe(b);
      }),
      { numRuns: 300 },
    );
  });
});
