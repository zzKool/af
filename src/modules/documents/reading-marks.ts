// What the reading found and where (F141, the board *Documents*: "boxes on the document for each field"): the typed
// fields a document shows — vendor, number, dates, total… — each with DI's confidence and the box it was printed
// in, and the pages' size the boxes are measured in. Pure, client-safe: the inbox's *What it read* lists them, the
// preview draws the boxes, a hover joins the two. A reading before F141 has confidences but no boxes.
import { confidenceLabel } from "@/kernel/ocr/confidence";
import { fieldBox, fieldConfidence, type OcrTypedKey } from "@/kernel/ocr/fields";
import type { OcrBox, OcrExtractedData, OcrPage } from "@/kernel/ocr/ocr";

/** The typed fields *What it read* shows, in reading order. */
export const MARKED_KEYS = [
  "vendorName",
  "merchantName",
  "vendorTaxId",
  "invoiceNumber",
  "invoiceDate",
  "transactionDate",
  "dueDate",
  "subtotal",
  "totalTax",
  "invoiceTotal",
] as const satisfies readonly OcrTypedKey[];
export type MarkedKey = (typeof MARKED_KEYS)[number];

export type ReadMark = { key: MarkedKey; confidence: number | null; box: OcrBox | null };
export type ReadingMarks = { pages: OcrPage[]; marks: ReadMark[] };

/** The marks of a reading: each shown key the reading has a value for, its confidence and box. */
export function readingMarks(
  data: Pick<OcrExtractedData, "fields" | "modelUsed" | "pages"> & Partial<OcrExtractedData>,
): ReadingMarks {
  const marks: ReadMark[] = [];
  for (const key of MARKED_KEYS) {
    const value = data[key];
    if (value === undefined || value === null || value === "") continue;
    marks.push({ key, confidence: fieldConfidence(data, key), box: fieldBox(data, key) });
  }
  return { pages: data.pages ?? [], marks };
}

/** *N sure · M to check*: sure = DI's high band (≥ 0.90); a field without a confidence counts as to check. */
export function sureCount(marks: readonly ReadMark[]): { sure: number; check: number } {
  const sure = marks.filter((m) => confidenceLabel(m.confidence) === "high").length;
  return { sure, check: marks.length - sure };
}
