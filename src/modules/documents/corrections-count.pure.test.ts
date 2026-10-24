import { describe, expect, it } from "vitest";
import { countCorrections } from "./corrections-count";

const ocr = {
  vendorName: "Northwind Cloud Inc.",
  invoiceTotal: 49,
  currency: "USD",
  items: [{ description: "Cloud plan", amount: 49 }],
  confidence: 0.98,
  modelUsed: "prebuilt-invoice",
  pageCount: 1,
  processingTimeMs: 900,
};

describe("countCorrections", () => {
  it("is 0 for an untouched document — the read fields are not corrections", () => {
    expect(countCorrections(ocr, { ...ocr })).toBe(0);
  });

  it("counts each corrected field once, the line items as one", () => {
    expect(
      countCorrections(ocr, {
        ...ocr,
        vendorName: "Northwind",
        currency: "EUR",
        items: [{ description: "Cloud plan (per seat)", amount: 49 }],
      }),
    ).toBe(3);
  });

  it("counts a field the OCR missed and the owner filled", () => {
    expect(countCorrections(ocr, { ...ocr, invoiceNumber: "NW-1" })).toBe(1);
  });

  it("an emptied or unticked field equals a missing one", () => {
    expect(countCorrections(ocr, { ...ocr, invoiceNumber: "", reverseCharge: false })).toBe(0);
  });

  it("without OCR data, every filled field is a correction", () => {
    expect(countCorrections(null, { vendorName: "A", invoiceTotal: 1 })).toBe(2);
  });
});
