// The invoices page's hero (F163) — pure: the year in the base (credit notes take back), open and late with the
// oldest named, drafts, twelve months, the clients ranked.
import { describe, expect, it } from "vitest";
import { type InvoiceOverviewRow, invoicesOverviewFrom } from "./overview";

const row = (o: Partial<InvoiceOverviewRow>): InvoiceOverviewRow => ({
  id: Math.random().toString(36).slice(2),
  type: "invoice",
  status: "issued",
  state: "paid",
  number: "X26-INV-001",
  partnerName: "Client A",
  issueDate: "2026-03-10",
  dueDate: "2026-04-09",
  currency: "CHF",
  totalAmount: "1000.00",
  totalBase: "11000.00",
  remaining: "0.00",
  ...o,
});

describe("invoicesOverviewFrom", () => {
  const today = "2026-07-15";
  const o = invoicesOverviewFrom(
    [
      row({}),
      row({
        issueDate: "2026-06-01",
        state: "overdue",
        remaining: "500.00",
        number: "X26-INV-002",
        dueDate: "2026-07-01",
      }),
      row({
        issueDate: "2026-07-02",
        state: "sent",
        remaining: "1000.00",
        partnerName: "Client B",
        dueDate: "2026-08-01",
      }),
      row({
        type: "credit_note",
        issueDate: "2026-07-05",
        totalBase: "1100.00",
        totalAmount: "100.00",
      }),
      row({ status: "draft", state: "draft", issueDate: "2026-07-14" }),
      row({ issueDate: "2025-05-01" }),
      row({ issueDate: "2025-09-01" }), // after today's day last year — not in the span
      row({ type: "quote", issueDate: "2026-02-01" }),
    ],
    today,
  );

  it("the year in the base: invoices minus credit notes, drafts and quotes left out", () => {
    expect(o.invoicedYear).toBe("31900.00"); // 3 × 11 000 − 1 100
    expect(o.invoicedLastYear).toBe("11000.00");
  });

  it("open and late in the base at each document's own rate; the oldest late one named", () => {
    expect(o.open).toEqual({ count: 2, base: "16500.00" }); // 500 × 11 + 1 000 × 11
    expect(o.overdue.count).toBe(1);
    expect(o.overdue.base).toBe("5500.00");
    expect(o.overdue.oldest).toEqual({ number: "X26-INV-002", days: 14 });
    expect(o.drafts.count).toBe(1);
    expect(o.paidYear).toBe(1);
  });

  it("twelve months, amber when something of the month is open; the clients ranked", () => {
    expect(o.months).toHaveLength(12);
    expect(o.months.at(-1)).toEqual({ month: "2026-07", base: "9900.00", open: true });
    expect(o.months.find((m) => m.month === "2026-03")).toEqual({
      month: "2026-03",
      base: "11000.00",
      open: false,
    });
    expect(o.clients[0]).toEqual({ name: "Client A", base: "20900.00" });
    expect(o.clients[1]).toEqual({ name: "Client B", base: "11000.00" });
  });
});
