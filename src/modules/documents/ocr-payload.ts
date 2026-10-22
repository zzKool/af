// The OCR facts of a document: the `ocr_data` JSONB the OCR job writes (`{ extractedData, rawResponse, quality }`)
// read back in one place, and the owner's corrections laid over them. Pure — no db, no storage.
import type { Prisma } from "@/generated/prisma/client";
import type { OcrExtractedData } from "@/kernel/ocr/ocr";

/** What the services read from `documents.ocr_data`; `rawResponse` stays in the column. */
export type OcrPayload = {
  extractedData: OcrExtractedData | null;
  quality: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `ocr_data` → the payload, or null when the OCR has not run (the column is null or not an object). */
export function parseOcrPayload(ocrData: Prisma.JsonValue | null): OcrPayload | null {
  if (!isRecord(ocrData)) return null;
  return {
    extractedData: isRecord(ocrData.extractedData)
      ? (ocrData.extractedData as unknown as OcrExtractedData)
      : null,
    quality: typeof ocrData.quality === "string" ? ocrData.quality : null,
  };
}

// --- Shared utility: resolve corrections over OCR data ---
// Epic 7 match scoring imports this
export function resolveDocumentData(
  extractedData: OcrExtractedData | null,
  corrections: Partial<OcrExtractedData> | null,
): Partial<OcrExtractedData> {
  if (!extractedData && !corrections) return {};
  if (!extractedData) return corrections ?? {};
  if (!corrections) return extractedData;
  return { ...extractedData, ...corrections }; // shallow merge, arrays fully replaced
}
