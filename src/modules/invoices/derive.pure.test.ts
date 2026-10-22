import { describe, expect, it } from "vitest";
import {
  declarationPeriodFor,
  deriveState,
  isDeclarationPeriod,
  receivableAmount,
  remainingAmount,
} from "./derive";

const base = {
  type: "invoice" as const,
  status: "issued" as const,
  totalAmount: "25944.00",
  dueDate: "2026-03-02",
  allocated: "0.00",
  credited: "0.00",
  convertedTo: null,
};

describe("derived invoice state (never typed)", () => {
  it("draft / issued / sent / overdue by date", () => {
    expect(deriveState({ ...base, status: "draft" }, "2026-02-01")).toBe("draft");
    expect(deriveState(base, "2026-02-01")).toBe("issued");
    expect(deriveState({ ...base, status: "sent" }, "2026-02-01")).toBe("sent");
    expect(deriveState({ ...base, status: "sent" }, "2026-03-02")).toBe("sent"); // due today is not overdue
    expect(deriveState({ ...base, status: "sent" }, "2026-03-03")).toBe("overdue");
    expect(deriveState(base, "2026-03-03")).toBe("overdue");
  });

  it("paid from allocations within the settlement tolerance (D25); partially paid otherwise", () => {
    expect(deriveState({ ...base, allocated: "25944.00" }, "2026-04-01")).toBe("paid");
    expect(deriveState({ ...base, allocated: "25934.00" }, "2026-04-01")).toBe("paid"); // 10 CHF fee
    expect(deriveState({ ...base, allocated: "20000.00" }, "2026-04-01")).toBe("partially_paid");
    expect(deriveState({ ...base, allocated: "20000.00" }, "2026-02-01")).toBe("partially_paid");
    expect(remainingAmount("25944.00", "20000.00")).toBe("5944.00");
    expect(remainingAmount("25944.00", "25934.00")).toBe("10.00");
    expect(remainingAmount("25944.00", "30000.00")).toBe("0.00");
  });

  it("credited: fully → credited; partially → the rest can still be paid", () => {
    expect(deriveState({ ...base, credited: "25944.00" }, "2026-04-01")).toBe("credited");
    expect(deriveState({ ...base, credited: "30000.00" }, "2026-04-01")).toBe("credited");
    const partial = { ...base, credited: "5837.40" };
    expect(deriveState(partial, "2026-02-01")).toBe("issued");
    expect(deriveState({ ...partial, allocated: "20106.60" }, "2026-02-01")).toBe("paid");
    expect(remainingAmount("25944.00", "0.00", "5837.40")).toBe("20106.60");
    // a credit note itself is never "credited"
    expect(deriveState({ ...base, type: "credit_note", credited: "999.00" }, "2026-02-01")).toBe(
      "issued",
    );
  });

  it("a credit note is never overdue and never a receivable (F57)", () => {
    // createCreditNote stores due date = issue date: the day after, it must still not read overdue
    const cn = {
      ...base,
      type: "credit_note" as const,
      totalAmount: "5837.40",
      dueDate: "2026-02-01",
    };
    expect(deriveState(cn, "2026-02-02")).toBe("issued");
    expect(deriveState({ ...cn, status: "sent" }, "2027-01-01")).toBe("sent");
    // refunded to the client through a bank row: settled like any document
    expect(deriveState({ ...cn, allocated: "5837.40" }, "2026-03-01")).toBe("paid");
    expect(receivableAmount(cn)).toBe("0.00");
    expect(receivableAmount({ ...cn, status: "sent" })).toBe("0.00");
    // the invoice it credits is the receivable, reduced by the credit note
    expect(receivableAmount({ ...base, credited: "5837.40" })).toBe("20106.60");
    expect(receivableAmount({ ...base, credited: "5837.40", allocated: "20106.60" })).toBe("0.00");
    expect(receivableAmount({ ...base, status: "draft" })).toBe("0.00");
    expect(receivableAmount({ ...base, type: "quote" })).toBe("0.00");
    // an invoice past its due date still goes overdue
    expect(deriveState(base, "2026-03-03")).toBe("overdue");
  });

  it("quotes: accepted / declined by hand, expired by date, converted once the invoice is issued", () => {
    const quote = { ...base, type: "quote" as const, dueDate: "2026-02-28" };
    expect(deriveState(quote, "2026-02-01")).toBe("issued");
    expect(deriveState(quote, "2026-03-01")).toBe("expired");
    expect(deriveState({ ...quote, status: "accepted" }, "2026-03-01")).toBe("accepted");
    expect(deriveState({ ...quote, status: "declined" }, "2026-02-01")).toBe("declined");
    expect(
      deriveState({ ...quote, status: "accepted", convertedTo: "VA26-003" }, "2026-02-01"),
    ).toBe("converted");
    expect(deriveState({ ...quote, allocated: "100.00" }, "2026-02-01")).toBe("issued"); // money never settles a quote
  });

  it("declaration period from the issue date (CH quarters)", () => {
    expect(declarationPeriodFor("CH", "2026-01-31")).toBe("CH 2026/Q1");
    expect(declarationPeriodFor("ch", "2026-03-31")).toBe("CH 2026/Q1");
    expect(declarationPeriodFor("CH", "2026-04-01")).toBe("CH 2026/Q2");
    expect(declarationPeriodFor("CH", "2026-12-31")).toBe("CH 2026/Q4");
    expect(isDeclarationPeriod("CH 2026/Q4")).toBe(true);
    expect(isDeclarationPeriod("CH 2026/Q5")).toBe(false);
    expect(isDeclarationPeriod("2026/Q1")).toBe(false);
  });
});
