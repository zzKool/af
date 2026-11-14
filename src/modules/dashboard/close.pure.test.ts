import { describe, expect, it } from "vitest";
import {
  type CloseFacts,
  closeSteps,
  closeStreak,
  defaultCloseMonth,
  invoiceReminders,
} from "./close";

// Invented facts (D51): one SEK and one CHF main account, July 2026.
const account = (label: string, completeTo: string | null) => ({
  label,
  currency: label.slice(-3),
  completeTo,
  complete: completeTo !== null && completeTo >= "2026-07-31",
});

const july = (over: Partial<CloseFacts> = {}): CloseFacts => ({
  month: "2026-07",
  rates: { weekdays: 23, missing: 0 },
  accounts: [account("Main SEK", "2026-07-31"), account("Main CHF", "2026-07-31")],
  rows: { justified: 35, toJustify: 6 },
  privateExpenses: 2,
  builtOn: null,
  ...over,
});

const states = (f: CloseFacts) => closeSteps(f).steps.map((s) => `${s.kind}:${s.state}`);

describe("closeSteps — the owner's four steps and the package (FR-004)", () => {
  it("the board's July: rates and statements done, the rows the current step, the package waiting", () => {
    const { steps, percent } = closeSteps(july());
    expect(steps.map((s) => `${s.kind}:${s.state}`)).toEqual([
      "rates:done",
      "statements:done",
      "justified:current",
      "expenses:todo",
      "closed:waiting",
    ]);
    expect(steps[2]).toMatchObject({ done: 35, total: 41, href: "/banking/reconcile" });
    // 1 + 1 + 35/41 + 0 + 0 = 2.85 → 57 %
    expect(percent).toBe(57);
  });

  it("a missing rate day makes the rates the current step — the rows still count but are not current", () => {
    expect(states(july({ rates: { weekdays: 23, missing: 2 } })).slice(0, 3)).toEqual([
      "rates:current",
      "statements:done",
      "justified:todo",
    ]);
  });

  it("one account short of the month's last day: the statements are not done", () => {
    const f = july({
      accounts: [account("Main SEK", "2026-07-31"), account("Main CHF", "2026-07-24")],
    });
    const s = closeSteps(f).steps[1];
    expect(s).toMatchObject({ state: "current", done: 1, total: 2 });
  });

  it("every row justified: the private expenses are current and the package is ready to build", () => {
    expect(states(july({ rows: { justified: 41, toJustify: 0 } })).slice(3)).toEqual([
      "expenses:current",
      "closed:waiting",
    ]);
  });

  it("no row and no statement yet: nothing is justified by default", () => {
    const f = july({ rows: { justified: 0, toJustify: 0 }, accounts: [account("Main SEK", null)] });
    expect(closeSteps(f).steps[2]?.state).not.toBe("done");
  });

  it("the package built: the expenses and the month are done, 100 % when the rest is too", () => {
    const f = july({ rows: { justified: 41, toJustify: 0 }, builtOn: "2026-08-04" });
    expect(states(f).every((s) => s.endsWith(":done"))).toBe(true);
    expect(closeSteps(f).percent).toBe(100);
  });

  it("built with rows still open: each step says its own truth", () => {
    expect(states(july({ builtOn: "2026-08-04" }))).toContain("justified:current");
  });
});

describe("defaultCloseMonth · closeStreak", () => {
  it("last month until its package is built, then this month", () => {
    expect(defaultCloseMonth("2026-08-07", new Set())).toBe("2026-07");
    expect(defaultCloseMonth("2026-08-07", new Set(["2026-07"]))).toBe("2026-08");
    expect(defaultCloseMonth("2026-01-03", new Set())).toBe("2025-12");
    // F189: books that stop before last month — Work opens on their last month, built or not
    expect(defaultCloseMonth("2026-11-14", new Set(), "2023-06-30")).toBe("2023-06");
    expect(defaultCloseMonth("2026-11-14", new Set(["2026-10"]), "2023-06-30")).toBe("2023-06");
  });

  it("the months closed in a row back from last month — last month still open does not break it", () => {
    const built = new Set(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
    expect(closeStreak("2026-08", built)).toBe(5);
    expect(closeStreak("2026-07", built)).toBe(5);
    expect(closeStreak("2026-07", new Set(["2026-06", "2026-04"]))).toBe(1);
    expect(closeStreak("2026-09", built)).toBe(0);
  });
});

describe("invoiceReminders — the client invoiced for last month, not yet for this one (FR-005)", () => {
  const issued = [
    { partnerId: "p1", partnerName: "Acme Consulting", issueDate: "2026-07-02" },
    { partnerId: "p2", partnerName: "Beta Labs", issueDate: "2026-06-30" },
    { partnerId: "p2", partnerName: "Beta Labs", issueDate: "2026-07-31" },
  ];

  it("Acme was invoiced for June (issued 2 Jul), not for July: reminded from the 21st of July on", () => {
    expect(invoiceReminders("2026-07", "2026-08-07", issued)).toEqual([
      { partnerId: "p1", partnerName: "Acme Consulting", lastIssueDate: "2026-07-02" },
    ]);
  });

  it("nothing before the window opens", () => {
    expect(invoiceReminders("2026-07", "2026-07-20", issued)).toEqual([]);
  });

  it("a draft in the window counts as prepared", () => {
    const withDraft = [
      ...issued,
      { partnerId: "p1", partnerName: "Acme Consulting", issueDate: "2026-08-01" },
    ];
    expect(invoiceReminders("2026-07", "2026-08-07", withDraft)).toEqual([]);
  });

  it("a client never invoiced the month before is not a regular one: no reminder", () => {
    expect(invoiceReminders("2026-09", "2026-09-25", issued)).toEqual([]);
  });
});
