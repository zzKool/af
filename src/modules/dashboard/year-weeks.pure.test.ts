// The year strip (F158) — pure: weeks Monday → Sunday, the money summed per week, the square per account derived.
import { describe, expect, it } from "vitest";
import { isoWeek, mondayOf, YEAR_WEEKS, yearWeeks } from "./year-weeks";

const accounts = [
  { id: "a", label: "Konto A", currency: "CHF" },
  { id: "b", label: "Konto B", currency: "EUR" },
];
const day = (
  date: string,
  bankAccountId: string,
  rows: number,
  toJustify: number,
  inB = "0.00",
  outB = "0.00",
) => ({
  date,
  bankAccountId,
  rows,
  toJustify,
  inBase: inB,
  outBase: outB,
});

describe("mondayOf / isoWeek", () => {
  it("the week's Monday; the ISO number", () => {
    expect(mondayOf("2026-11-09")).toBe("2026-11-09"); // a Monday
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // its Sunday
    expect(isoWeek("2026-07-13")).toBe(29);
    expect(isoWeek("2025-12-29")).toBe(1); // the week of 1 January 2026
    expect(isoWeek("2026-12-28")).toBe(53);
  });
});

describe("yearWeeks", () => {
  const today = "2026-11-11";
  const y = yearWeeks(
    accounts,
    [
      day("2026-11-10", "a", 2, 0, "100.00", "40.50"),
      day("2026-11-11", "b", 1, 1, "0.00", "9.50"),
      day("2026-10-06", "a", 3, 1), // last month: still open
      day("2026-09-08", "a", 1, 1), // before last month: late
      day("2026-09-09", "b", 2, 0),
      day("2024-01-02", "a", 9, 9), // outside the window
    ],
    today,
  );

  it("fifty-two weeks, the last one today's", () => {
    expect(y.weeks).toHaveLength(YEAR_WEEKS);
    expect(y.weeks.at(-1)?.from).toBe("2026-11-09");
    expect(y.weeks.at(-1)?.to).toBe("2026-11-15");
  });

  it("the money and the rows summed per week", () => {
    const w = y.weeks.at(-1);
    expect(w?.inBase).toBe("100.00");
    expect(w?.outBase).toBe("50.00");
    expect(w?.rows).toBe(3);
    expect(w?.toJustify).toBe(1);
    expect(w?.cells).toEqual(["done", "open"]);
  });

  it("open in last month, late before it, none without a row", () => {
    const at = (from: string) => y.weeks.find((w) => w.from === from)?.cells;
    expect(at("2026-10-05")).toEqual(["open", "none"]);
    expect(at("2026-09-07")).toEqual(["late", "done"]);
    expect(y.weeks.reduce((n, w) => n + w.rows, 0)).toBe(9); // the 2024 rows are not in
  });
});
