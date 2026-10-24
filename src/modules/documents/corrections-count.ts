// How many fields the owner corrected on the review page: what now differs from the OCR's reading. Pure.
import type { OcrExtractedData } from "@/kernel/ocr/ocr";

const CORRECTABLE = [
  "vendorName",
  "vendorTaxId",
  "merchantName",
  "invoiceNumber",
  "invoiceDate",
  "transactionDate",
  "dueDate",
  "currency",
  "invoiceTotal",
  "subtotal",
  "totalTax",
  "customerName",
  "customerTaxId",
  "reverseCharge",
  "items",
] as const;

const blank = (v: unknown) => v === undefined || v === null || v === "" || v === false;

/** How many correctable fields now differ from what the OCR read (an empty field equals a missing one). */
export function countCorrections(
  extracted: Partial<OcrExtractedData> | null,
  resolved: Partial<OcrExtractedData>,
): number {
  return CORRECTABLE.filter((field) => {
    const before = extracted?.[field];
    const now = resolved[field];
    if (blank(before) && blank(now)) return false;
    return JSON.stringify(before) !== JSON.stringify(now);
  }).length;
}
