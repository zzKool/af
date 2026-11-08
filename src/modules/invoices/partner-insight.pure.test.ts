import { describe, expect, it } from "vitest";
import { type InsightRow, lastMonths, partnerInsightFrom } from "./partner-insight";
import type { PaidInvoice } from "./payment-stats";

// F144 — the partner page's invoicing, derived from the client's documents and the days they took to pay.
// Invented client, invented amounts.
const row = (r: Partial<InsightRow> & Pick<InsightRow, "id" | "issueDate">): InsightRow => ({
  type: "invoice",
  status: "sent",
  number: `IC-${r.id}`,
  periodLabel: null,
  currency: "CHF",
  totalAmount: "1000.00",
  remaining: "0.00",
  sentAt: null,
  ...r,
});
const paid = (
  id: string,
  issueDate: string,
  paidOn: string,
  days: number,
  late = false,
): PaidInvoice => ({
  id,
  number: `IC-${id}`,
  issueDate,
  dueDate: null,
  paidOn,
  days,
  late,
});

describe("lastMonths", () => {
  it("twelve months up to today's, across the year", () => {
    const m = lastMonths("2026-07-20");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2025-08");
    expect(m[11]).toBe("2026-07");
  });
});

describe("partnerInsightFrom (F144)", () => {
  const today = "2026-07-20";
  const rows: InsightRow[] = [
    row({ id: "a", issueDate: "2026-01-31", sentAt: "2026-02-01" }),
    row({
      id: "b",
      issueDate: "2026-06-30",
      totalAmount: "2000.00",
      remaining: "2000.00",
      status: "issued",
    }),
    row({ id: "c", issueDate: "2026-02-15", type: "credit_note", totalAmount: "100.00" }),
    row({ id: "d", issueDate: "2025-03-31", totalAmount: "800.00" }),
    row({ id: "e", issueDate: "2025-09-30", totalAmount: "5000.00" }), // after 20 July: not the same months
    row({
      id: "f",
      issueDate: "2026-07-31",
      status: "draft",
      number: null,
      periodLabel: "2026 July",
    }),
    row({ id: "g", issueDate: "2026-03-01", currency: "EUR", totalAmount: "9999.00" }),
    row({ id: "q", issueDate: "2026-03-01", type: "quote", totalAmount: "7777.00" }),
  ];
  const history = [
    paid("a", "2026-01-31", "2026-02-24", 24),
    paid("e", "2025-09-30", "2025-11-05", 36, true),
  ];
  const x = partnerInsightFrom(rows, history, "19.0", today);

  it("invoiced this year in the client's currency, a credit note taking back, against the same months last year", () => {
    expect(x.currency).toBe("CHF");
    expect(x.invoicedYear).toBe("2900.00"); // 1000 + 2000 − 100; the EUR invoice, the draft and the quote left out
    expect(x.invoicedLastYear).toBe("800.00");
  });

  it("what is not invoiced yet: the drafts, issued not sent, unpaid", () => {
    expect(x.drafts).toEqual({ count: 1, total: "1000.00", newest: { periodLabel: "2026 July" } });
    expect(x.notSent).toBe(1);
    expect(x.unpaid).toEqual({ count: 1, total: "2000.00" });
  });

  it("how long the client takes, late only this year counted", () => {
    expect(x.stats?.avgDays).toBe(30);
    expect(x.lateThisYear).toBe(0);
    expect(x.daysBilledYear).toBe("19.0");
  });

  it("twelve months: invoiced, the days to pay, open", () => {
    const jan = x.months.find((m) => m.month === "2026-01");
    expect(jan).toEqual({ month: "2026-01", invoiced: "1000.00", paidDays: 24, open: false });
    const jun = x.months.find((m) => m.month === "2026-06");
    expect(jun).toMatchObject({ invoiced: "2000.00", paidDays: null, open: true });
    expect(x.months.find((m) => m.month === "2025-09")?.paidDays).toBe(36);
  });

  it("what happened, newest first: the draft, issued, sent, paid — no quote", () => {
    expect(x.events.slice(0, 3).map((e) => [e.kind, e.date])).toEqual([
      ["draft", "2026-07-31"],
      ["issued", "2026-06-30"],
      ["issued", "2026-03-01"],
    ]);
    expect(x.events.find((e) => e.kind === "paid" && e.number === "IC-a")).toMatchObject({
      date: "2026-02-24",
      days: 24,
    });
    expect(x.events.some((e) => e.amount === "7777.00")).toBe(false);
    expect(x.invoiceCount).toBe(7);
  });

  it("no invoice at all: no currency, zeros", () => {
    const empty = partnerInsightFrom([], [], "0.0", today);
    expect(empty.currency).toBeNull();
    expect(empty.invoicedYear).toBe("0.00");
    expect(empty.stats).toBeNull();
    expect(empty.events).toEqual([]);
  });
});
