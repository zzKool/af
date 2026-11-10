// The year strip (F158) — pure: weeks Monday → Sunday, the money summed per week, the square per account derived;
// F171: the invoices', expenses' and documents' rows, each thing's state mapped, the week the worst of them;
// F181: the subscriptions' row, each expected charge's period state mapped.
import { describe, expect, it } from "vitest";
import {
  documentCell,
  expenseCell,
  invoiceCell,
  isoWeek,
  mondayOf,
  subscriptionCell,
  YEAR_WEEKS,
  yearWeeks,
} from "./year-weeks";

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

describe("the books' squares (F171)", () => {
  const today = "2026-11-11";

  it("an invoice: paid or credited done, overdue late, unpaid open; drafts, quotes, credit notes out", () => {
    const cell = (state: string, type = "invoice") => invoiceCell({ type, state });
    expect(cell("paid")).toBe("done");
    expect(cell("credited")).toBe("done");
    expect(cell("overdue")).toBe("late");
    expect(["issued", "sent", "partially_paid"].map((s) => cell(s))).toEqual([
      "open",
      "open",
      "open",
    ]);
    expect(cell("draft")).toBeNull();
    expect(cell("issued", "quote")).toBeNull();
    expect(cell("issued", "credit_note")).toBeNull();
  });

  it("an expense: done when settled and justified, else open — late before last month", () => {
    const e = (over: Partial<Parameters<typeof expenseCell>[0]>) =>
      expenseCell(
        {
          date: "2026-11-02",
          status: "paid",
          kind: "receipt",
          hasDocument: true,
          documentMissing: false,
          ...over,
        },
        today,
      );
    expect(e({})).toBe("done");
    expect(e({ status: "refunded" })).toBe("done");
    expect(e({ hasDocument: false, documentMissing: true })).toBe("done"); // receipt declared lost
    expect(e({ hasDocument: false, kind: "per_diem" })).toBe("done"); // computed, no receipt
    expect(e({ hasDocument: false })).toBe("open"); // paid, the receipt missing
    expect(e({ status: "awaiting_link" })).toBe("open");
    expect(e({ status: "partially_refunded", date: "2026-10-31" })).toBe("open"); // last month
    expect(e({ status: "to_refund", date: "2026-09-30" })).toBe("late"); // its close is past
  });

  it("a document: filed or parked done, in the inbox open — late before last month; generated out", () => {
    expect(documentCell("filed", "2026-08-01", today)).toBe("done");
    expect(documentCell("archived", "2026-08-01", today)).toBe("done");
    expect(documentCell("ready", "2026-10-01", today)).toBe("open");
    expect(documentCell("ocr_failed", "2026-11-10", today)).toBe("open");
    expect(documentCell("needs_ocr", "2026-09-30", today)).toBe("late");
    expect(documentCell("generated", "2026-11-10", today)).toBeNull();
  });

  it("a week takes its worst thing; counted and pending per lane; none without a thing", () => {
    const y = yearWeeks(accounts, [], today, {
      invoices: [
        { date: "2026-11-09", cell: "done" },
        { date: "2026-11-12", cell: "late" },
        { date: "2026-11-13", cell: "open" },
        { date: "2023-01-02", cell: "late" }, // outside the window
      ],
      expenses: [
        { date: "2026-11-10", cell: "done" },
        { date: "2026-11-02", cell: "open" },
      ],
      documents: [{ date: "2026-11-15", cell: "done" }],
    });
    const last = y.weeks.at(-1);
    expect(last?.books.invoices).toEqual({ cell: "late", count: 3, pending: 2 });
    expect(last?.books.expenses).toEqual({ cell: "done", count: 1, pending: 0 });
    expect(last?.books.documents).toEqual({ cell: "done", count: 1, pending: 0 });
    expect(y.weeks.at(-2)?.books.expenses).toEqual({ cell: "open", count: 1, pending: 1 });
    expect(y.weeks.at(-2)?.books.invoices).toEqual({ cell: "none", count: 0, pending: 0 });
    expect(y.weeks.reduce((n, w) => n + w.books.invoices.count, 0)).toBe(3);
    expect(last?.cells).toEqual(["none", "none"]); // the bank's squares untouched
  });
});

describe("the subscriptions' squares (F181)", () => {
  const today = "2026-11-11";

  it("a charge: done when the period is done; expected, unseen or unjustified open — late before last month", () => {
    const c = (state: string, date = "2026-11-05") => subscriptionCell({ date, state }, today);
    expect(c("done")).toBe("done");
    expect(c("done", "2025-12-01")).toBe("done"); // done stays done, however old
    expect(c("upcoming", "2026-11-15")).toBe("open"); // expected this week, not seen yet
    expect(c("due")).toBe("open"); // nothing arrived yet
    expect(c("charged", "2026-10-03")).toBe("open"); // paid, the receipt missing — last month: the close runs
    expect(c("documented")).toBe("open"); // the bill, not paid yet
    expect(c("due", "2026-09-30")).toBe("late"); // its month's close is past
    expect(c("charged", "2026-08-03")).toBe("late");
    expect(c("skipped")).toBeNull(); // a pause: no charge expected
  });

  it("the row: one per expected charge on its date, the week the worst; the other rows untouched", () => {
    const y = yearWeeks(accounts, [], today, {
      subscriptions: [
        { date: "2026-11-09", cell: "done" },
        { date: "2026-11-15", cell: "open" },
        { date: "2026-09-07", cell: "late" },
        { date: "2027-01-04", cell: "open" }, // after the strip
      ],
    });
    expect(y.weeks.at(-1)?.books.subscriptions).toEqual({ cell: "open", count: 2, pending: 1 });
    const sept = y.weeks.find((w) => w.from === "2026-09-07");
    expect(sept?.books.subscriptions).toEqual({ cell: "late", count: 1, pending: 1 });
    expect(y.weeks.reduce((n, w) => n + w.books.subscriptions.count, 0)).toBe(3);
    expect(y.weeks.at(-1)?.books.invoices).toEqual({ cell: "none", count: 0, pending: 0 });
  });
});
