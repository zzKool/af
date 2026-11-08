import { describe, expect, it } from "vitest";
import { MOCK_RESPONSES } from "@/kernel/ocr/__fixtures__/mock-responses";
import { mapAnalyzeResult } from "@/kernel/ocr/ocr";
import { readingMarks, sureCount } from "./reading-marks";

// The mock's invented invoice (Test Vendor AB · 1 250.00 · INV-2026-001) as the real mapper reads it (F141).
const invoice = MOCK_RESPONSES.invoice;
const { data } = mapAnalyzeResult(
  invoice?.analyzeResult as never,
  invoice?.modelId ?? "prebuilt-invoice",
  invoice?.processingTimeMs ?? 0,
);

describe("readingMarks (F141)", () => {
  it("the shown fields the reading has, in reading order, each with its confidence and its box", () => {
    const r = readingMarks(data);
    expect(r.pages).toEqual([{ page: 1, width: 8.5, height: 11, unit: "inch" }]);
    expect(r.marks.map((m) => m.key)).toEqual([
      "vendorName",
      "vendorTaxId",
      "invoiceNumber",
      "invoiceDate",
      "subtotal",
      "totalTax",
      "invoiceTotal",
    ]);
    const total = r.marks.find((m) => m.key === "invoiceTotal");
    expect(total?.confidence).toBe(0.98);
    expect(total?.box?.page).toBe(1);
    expect(total?.box?.polygon).toHaveLength(8);
  });

  it("N sure · M to check: the high band is sure, the invoice number at 0.81 is to check", () => {
    expect(sureCount(readingMarks(data).marks)).toEqual({ sure: 6, check: 1 });
  });

  it("a reading before F141: confidences, no boxes, no pages", () => {
    const old = readingMarks({ ...data, pages: undefined, fields: {} });
    expect(old.pages).toEqual([]);
    expect(old.marks.every((m) => m.box === null && m.confidence === null)).toBe(true);
  });
});
