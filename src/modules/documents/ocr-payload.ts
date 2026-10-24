// The OCR facts of a document: the `ocr_data` JSONB the OCR job writes (`{ extractedData, rawResponse, quality }`)
// read back in one place, and the owner's corrections laid over them. Pure — no db, no storage.
import { z } from "zod/v4";
import type { Prisma } from "@/generated/prisma/client";
import { CURRENCIES, type Currency } from "@/kernel/nav/constants";
import type { OcrExtractedData } from "@/kernel/ocr/ocr";

/** What the services read from `documents.ocr_data`; `rawResponse` stays in the column. */
export type OcrPayload = {
  extractedData: OcrExtractedData | null;
  quality: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What the OCR job writes into `documents.ocr_data`. */
export type OcrPayloadWrite = {
  extractedData: OcrExtractedData;
  rawResponse: Record<string, unknown>;
  quality: string;
};

function isJsonObject(value: unknown): value is Prisma.JsonObject {
  return isRecord(value);
}

/**
 * The OCR job's write mapper (F50-f): the payload as the JSON Prisma stores — through a JSON round trip, which is
 * what the column would hold anyway (undefined fields dropped, dates as ISO strings). Read back by `parseOcrPayload`.
 */
export function ocrPayloadToJson(payload: OcrPayloadWrite): Prisma.InputJsonObject {
  const json: unknown = JSON.parse(JSON.stringify(payload));
  return isJsonObject(json) ? json : {};
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

// --- The owner's corrections (`documents.corrections`, a JSONB patch merged by key) ---
// One schema per field, used twice: strict on write (the action and the service refuse a bad patch) and per field
// on read (a stored value that does not fit is dropped, so one bad row never breaks the library or the inbox).

const text = z.string().max(500);
const isoDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const amount = z.number().finite();
const lineItem = z
  .object({
    description: text.optional(),
    quantity: amount.optional(),
    unitPrice: amount.optional(),
    amount: amount.optional(),
    tax: amount.optional(),
    taxRate: z.number().min(0).max(100).optional(),
  })
  .strict();

const CORRECTION_FIELDS = {
  vendorName: text,
  vendorTaxId: text,
  merchantName: text,
  invoiceNumber: text,
  customerName: text,
  customerTaxId: text,
  reverseCharge: z.boolean(),
  invoiceDate: isoDate,
  transactionDate: isoDate,
  dueDate: isoDate,
  currency: z.enum(CURRENCIES),
  invoiceTotal: amount,
  subtotal: amount,
  totalTax: amount,
  items: z.array(lineItem).max(500),
} as const;

/** A corrections patch as the review page sends it — any subset of the fields, nothing else, no nulls. */
export const correctionsPatchSchema = z.object(CORRECTION_FIELDS).partial().strict();
export type CorrectionsPatch = z.infer<typeof correctionsPatchSchema>;

/** `corrections` → the fields that fit their schema; a value that does not is dropped (never thrown). */
export function parseCorrections(value: unknown): Partial<OcrExtractedData> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(CORRECTION_FIELDS)) {
    if (!(key in value)) continue;
    const parsed = (schema as z.ZodType).safeParse(value[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Partial<OcrExtractedData>;
}

/** An OCR or corrected amount as a 2-decimal string, or null when there is none. */
export function amountText(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : null;
}

/** The document's currency when it is one the app knows (OCR's code or the owner's correction), else null. */
export function knownCurrency(value: unknown): Currency | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return (CURRENCIES as readonly string[]).includes(code) ? (code as Currency) : null;
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
