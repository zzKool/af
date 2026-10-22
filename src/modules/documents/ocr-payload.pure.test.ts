// The corrections contract (lessons audit 11, F61): strict on write, per field on read — a stored value that
// does not fit is dropped so one bad row never breaks a list; and the currency is one the app knows or none.
import { describe, expect, it } from "vitest";
import {
  amountText,
  correctionsPatchSchema,
  knownCurrency,
  parseCorrections,
  resolveDocumentData,
} from "./ocr-payload";

describe("correctionsPatchSchema (write)", () => {
  it("accepts what the review page sends", () => {
    const patch = {
      vendorName: "SBB",
      invoiceTotal: 120.5,
      currency: "CHF",
      transactionDate: "2026-03-10",
      dueDate: "",
      items: [{ description: "Ticket", amount: 120.5 }],
    };
    expect(correctionsPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("refuses a null amount, an unknown currency, a bad date and a field it does not know", () => {
    for (const bad of [
      { invoiceTotal: null },
      { invoiceTotal: "120.50" },
      { currency: "GBP" },
      { invoiceDate: "10.03.2026" },
      { status: "linked" },
      { items: [{ amount: null }] },
    ]) {
      expect(correctionsPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("parseCorrections (read)", () => {
  it("keeps the fields that fit and drops the rest, never throws", () => {
    const stored = {
      invoiceTotal: null,
      currency: 42,
      vendorName: "OpenAI Ireland",
      junk: { a: 1 },
    };
    expect(parseCorrections(stored)).toEqual({ vendorName: "OpenAI Ireland" });
  });

  it("a non-object column is no corrections", () => {
    for (const v of [null, "x", 3, [1]]) expect(parseCorrections(v)).toBeNull();
  });

  it("a dropped correction falls back to the OCR value", () => {
    const merged = resolveDocumentData(
      {
        invoiceTotal: 20,
        currency: "USD",
        confidence: 1,
        modelUsed: "m",
        pageCount: 1,
        processingTimeMs: 1,
      },
      parseCorrections({ invoiceTotal: null }),
    );
    expect(amountText(merged.invoiceTotal)).toBe("20.00");
  });
});

describe("amountText / knownCurrency", () => {
  it("an amount only when it is a finite number", () => {
    expect(amountText(12.5)).toBe("12.50");
    for (const v of [undefined, null, "12.5", Number.NaN]) expect(amountText(v)).toBeNull();
  });

  it("a currency only when the app knows it, case-insensitively", () => {
    expect(knownCurrency("chf")).toBe("CHF");
    expect(knownCurrency(" EUR ")).toBe("EUR");
    for (const v of [undefined, null, "", "GBP", 42]) expect(knownCurrency(v)).toBeNull();
  });
});
