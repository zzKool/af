// F71: the derived state → D40 family map (one place in the module). Tested on the rule — the families the
// D40 table names, every state covered, and what the owner must chase (attention) coming out of deriveState.
import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import { type DeriveInput, deriveState } from "./derive";
import { INVOICE_STATE_FAMILY, invoiceStateFamily } from "./state-family";
import { INVOICE_STATES, type InvoiceState } from "./types";

const TODAY = "2026-07-15";
const issuedInvoice: DeriveInput = {
  type: "invoice",
  status: "issued",
  totalAmount: "1000.00",
  dueDate: "2026-07-31",
  allocated: "0",
  credited: "0",
  convertedTo: null,
};
const familyOf = (input: DeriveInput) => invoiceStateFamily(deriveState(input, TODAY));

describe("invoice state → family", () => {
  it("maps every derived state, and only to a kit family", () => {
    expect(Object.keys(INVOICE_STATE_FAMILY).sort()).toEqual([...INVOICE_STATES].sort());
    for (const state of INVOICE_STATES)
      expect(STATE_FAMILIES).toContain(INVOICE_STATE_FAMILY[state]);
  });

  it("follows the D40 table for the words it names", () => {
    const expected: Partial<Record<InvoiceState, string>> = {
      overdue: "attention",
      issued: "progress",
      sent: "progress",
      partially_paid: "progress",
      paid: "done",
      credited: "done",
      draft: "neutral",
    };
    for (const [state, family] of Object.entries(expected))
      expect(invoiceStateFamily(state as InvoiceState)).toBe(family);
  });

  it("only overdue asks for attention", () => {
    const attention = INVOICE_STATES.filter((s) => invoiceStateFamily(s) === "attention");
    expect(attention).toEqual(["overdue"]);
  });

  it("a quote's outcome: accepted is still to convert, converted is done, declined / expired are closed", () => {
    expect(invoiceStateFamily("accepted")).toBe("progress");
    expect(invoiceStateFamily("converted")).toBe("done");
    expect(invoiceStateFamily("declined")).toBe("neutral");
    expect(invoiceStateFamily("expired")).toBe("neutral");
  });
});

describe("from the derived model to the family", () => {
  it("an issued invoice not yet due is in progress; past due and unpaid it asks for attention", () => {
    expect(familyOf(issuedInvoice)).toBe("progress");
    expect(familyOf({ ...issuedInvoice, dueDate: "2026-07-01" })).toBe("attention");
  });

  it("paid within the settlement tolerance is done, even past due", () => {
    expect(familyOf({ ...issuedInvoice, dueDate: "2026-07-01", allocated: "1000.00" })).toBe(
      "done",
    );
  });

  it("partly paid past due stays in progress, not attention (the bank row is there)", () => {
    expect(familyOf({ ...issuedInvoice, dueDate: "2026-07-01", allocated: "400.00" })).toBe(
      "progress",
    );
  });

  it("a credit note past its date never asks for attention (F57)", () => {
    expect(familyOf({ ...issuedInvoice, type: "credit_note", dueDate: "2026-07-01" })).toBe(
      "progress",
    );
  });

  it("fully credited is done; a draft is neutral whatever its dates", () => {
    expect(familyOf({ ...issuedInvoice, credited: "1000.00" })).toBe("done");
    expect(familyOf({ ...issuedInvoice, status: "draft", dueDate: "2026-01-01" })).toBe("neutral");
  });
});
