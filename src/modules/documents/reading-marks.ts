// What the reading found and where (F141, the board *Documents*: "boxes on the document for each field"): the typed
// fields a document shows — vendor, number, dates, total… — each with DI's confidence and the box it was printed
// in, and the pages' size the boxes are measured in. Pure, client-safe: the inbox's *What it read* lists them, the
// preview draws the boxes, a hover joins the two. A reading before F141 has confidences but no boxes.
import { confidenceLabel } from "@/kernel/ocr/confidence";
import { fieldBox, fieldConfidence, fieldContent, type OcrTypedKey } from "@/kernel/ocr/fields";
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

/** One field the reading found: DI's confidence, where it was printed, and the text as printed (F185: the *to check*
 *  question quotes it — "“07-08” — August 7 or July 8?"). */
export type ReadMark = {
  key: MarkedKey;
  confidence: number | null;
  box: OcrBox | null;
  content?: string | null;
};
/** The pages, the marks and how long the reading took (F185: the document's header line, *read in 1.2 s*). */
export type ReadingMarks = { pages: OcrPage[]; marks: ReadMark[]; readMs?: number | null };

/** The marks of a reading: each shown key the reading has a value for, its confidence and box. */
export function readingMarks(
  data: Pick<OcrExtractedData, "fields" | "modelUsed" | "pages"> & Partial<OcrExtractedData>,
): ReadingMarks {
  const marks: ReadMark[] = [];
  for (const key of MARKED_KEYS) {
    const value = data[key];
    if (value === undefined || value === null || value === "") continue;
    marks.push({
      key,
      confidence: fieldConfidence(data, key),
      box: fieldBox(data, key),
      content: fieldContent(data, key),
    });
  }
  const ms = data.processingTimeMs;
  return {
    pages: data.pages ?? [],
    marks,
    readMs: typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : null,
  };
}

/** Whether a field is sure: DI's high band (≥ 0.90), or the owner's own word (F185: a field he corrected or
 *  confirmed is sure, whatever DI said). */
export function isSure(mark: ReadMark, corrected: readonly string[] = []): boolean {
  return corrected.includes(mark.key) || confidenceLabel(mark.confidence) === "high";
}

/** *N sure · M to check*: sure = DI's high band (≥ 0.90) or corrected by the owner; a field without a confidence
 *  counts as to check. */
export function sureCount(
  marks: readonly ReadMark[],
  corrected: readonly string[] = [],
): { sure: number; check: number } {
  const sure = marks.filter((m) => isSure(m, corrected)).length;
  return { sure, check: marks.length - sure };
}
