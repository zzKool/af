import { describe, expect, it } from "vitest";
import { translator } from "@/kernel/i18n/translate";
import { closeSteps } from "./close";
import { cashDays, cashSummary, ticker } from "./home";
import { homeSentence } from "./home-text";

// Invented balances and rates (D51): a SEK base, a CHF account and a SEK savings.
const days = ["2026-09-30", "2026-10-31", "2026-11-08"];
const rate = (day: string, c: string) =>
  c === "CHF" ? (day === "2026-11-08" ? "12.000000" : "11.500000") : null;

describe("cashDays", () => {
  it("the last day of the twelve months before this one, then today", () => {
    const d = cashDays("2026-11-08");
    expect(d).toHaveLength(13);
    expect(d[0]).toBe("2025-11-30");
    expect(d.at(-2)).toBe("2026-10-31");
    expect(d.at(-1)).toBe("2026-11-08");
  });
});

describe("cashSummary — the cash in the base (FR-006)", () => {
  const history = [
    { label: "Main CHF", currency: "CHF", balances: [null, "10000.00", "11000.00"] },
    { label: "Savings SEK", currency: "SEK", balances: ["50000.00", "50000.00", "48000.00"] },
  ];

  it("today's total through today's rate, the month's move, the twelve months", () => {
    const c = cashSummary("SEK", days, history, rate);
    // 11 000 × 12 + 48 000 = 180 000; last month 10 000 × 11.5 + 50 000 = 165 000
    expect(c.total).toBe("180000.00");
    expect(c.monthDelta).toBe("15000.00");
    expect(c.series.map((s) => s.total)).toEqual(["50000.00", "165000.00", "180000.00"]);
    expect(c.accounts.map((a) => [a.label, a.inBase, a.share])).toEqual([
      ["Main CHF", "132000.00", 73],
      ["Savings SEK", "48000.00", 27],
    ]);
    expect(c.incomplete).toBe(false);
  });

  it("a 1 % move of each foreign currency on what is held in it", () => {
    expect(cashSummary("SEK", days, history, rate).exposure).toEqual([
      { currency: "CHF", onePercent: "1320.00" },
    ]);
  });

  it("no rate today for an account: left out of the total, and said", () => {
    const c = cashSummary("SEK", days, history, () => null);
    expect(c.total).toBe("48000.00");
    expect(c.incomplete).toBe(true);
    expect(c.accounts[0]?.inBase).toBeNull();
  });

  it("no balance anywhere: zero, no month move, the series empty", () => {
    const c = cashSummary(
      "SEK",
      days,
      [{ label: "Main SEK", currency: "SEK", balances: [null, null, null] }],
      rate,
    );
    expect(c.total).toBe("0.00");
    expect(c.monthDelta).toBeNull();
    expect(c.series.every((s) => s.total === null)).toBe(true);
  });
});

describe("ticker (FR-007)", () => {
  it("now, the change over the window at 1 dp, the points", () => {
    const t = ticker({
      currency: "CHF",
      points: [
        { date: "2026-08-10", rate: "11.500000" },
        { date: "2026-11-06", rate: "11.845000" },
      ],
    });
    expect(t).toEqual({
      currency: "CHF",
      now: "11.845000",
      change: 3,
      points: ["11.500000", "11.845000"],
    });
  });

  it("no point: nothing to say", () => {
    expect(ticker({ currency: "USD", points: [] })).toEqual({
      currency: "USD",
      now: null,
      change: null,
      points: [],
    });
  });
});

describe("homeSentence (FR-008)", () => {
  const t = translator("en");
  const facts = {
    month: "2026-07",
    rates: { weekdays: 23, missing: 0 },
    accounts: [{ label: "Main CHF", currency: "CHF", completeTo: "2026-07-31", complete: true }],
    rows: { justified: 35, toJustify: 6 },
    privateExpenses: 2,
    builtOn: null,
  };
  const close = { ...facts, ...closeSteps(facts), previous: null, next: null, reminders: [] };
  const late = {
    id: "x",
    kind: "invoices_overdue" as const,
    count: 1,
    priority: "high" as const,
    href: "/",
  };

  it("what is late, then the month and its next step", () => {
    expect(homeSentence([late, late], close, "July 2026", t)).toBe(
      "2 thing(s) are late. July 2026 is 57 % done — next: 6 bank row(s) to justify.",
    );
  });

  it("the accountant: what is late only", () => {
    expect(homeSentence([], null, "", t)).toBe("Nothing is late.");
  });
});
