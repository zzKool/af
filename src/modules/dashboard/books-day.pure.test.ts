import { describe, expect, it } from "vitest";
import { booksDay, lastRowDay } from "./books-day";

describe("booksDay — the day the year's views take as their today (F189)", () => {
  it("books kept up to date: today", () => {
    expect(booksDay("2026-11-14", "2026-11-13")).toEqual({ day: "2026-11-14", behind: false });
    // last month's rows are still up to date: the statement of this month is not out yet
    expect(booksDay("2026-11-14", "2026-10-02")).toEqual({ day: "2026-11-14", behind: false });
    expect(booksDay("2026-01-03", "2025-12-31")).toEqual({ day: "2026-01-03", behind: false });
  });

  it("books that stop before last month: the end of their last month", () => {
    expect(booksDay("2026-11-14", "2023-06-28")).toEqual({ day: "2023-06-30", behind: true });
    expect(booksDay("2026-11-14", "2026-09-30")).toEqual({ day: "2026-09-30", behind: true });
    expect(booksDay("2024-03-10", "2024-01-15")).toEqual({ day: "2024-01-31", behind: true });
  });

  it("no row at all, or a row dated ahead: today", () => {
    expect(booksDay("2026-11-14", null)).toEqual({ day: "2026-11-14", behind: false });
    expect(booksDay("2026-11-14", "2026-12-31")).toEqual({ day: "2026-11-14", behind: false });
  });

  it("the newest day with a row, whatever the order; a day without rows does not count", () => {
    expect(
      lastRowDay([
        { date: "2023-06-28", rows: 2 },
        { date: "2023-04-03", rows: 1 },
        { date: "2023-07-01", rows: 0 },
      ]),
    ).toBe("2023-06-28");
    expect(lastRowDay([])).toBeNull();
  });
});
