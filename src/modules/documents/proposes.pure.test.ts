import { describe, expect, it } from "vitest";
import { readingProposes } from "./proposes";

// Invented readings (D51).
describe("readingProposes (D78)", () => {
  it("an invoice number or a VAT number: a supplier invoice", () => {
    expect(readingProposes({ invoiceTotal: 1269, invoiceNumber: "30418" })).toBe(
      "supplier_invoice",
    );
    expect(readingProposes({ invoiceTotal: 1269, vendorTaxId: "SE556677123401" })).toBe(
      "supplier_invoice",
    );
  });

  it("a till receipt — a merchant, no vendor: an expense", () => {
    expect(readingProposes({ invoiceTotal: 64, merchantName: "Invented Rail" })).toBe("expense");
  });

  it("no amount read: ask what it is", () => {
    expect(readingProposes({ vendorName: "Invented Law AB" })).toBe("ask");
    expect(readingProposes({})).toBe("ask");
  });
});
