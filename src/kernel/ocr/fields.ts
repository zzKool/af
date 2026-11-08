// Every field Azure Document Intelligence returned, kept as it was read (F127, review 2026-10-31 §3): the value
// normalised by DI's own field type, DI's per-field confidence, the printed text. The typed subset of
// `OcrExtractedData` (vendorName, invoiceTotal, …) is read from the same `documents[0].fields` by `mapAnalyzeResult`;
// this map is what the mapper does not type, with the confidence of what it does. Pure, client-safe: the SDK import
// is a type only.
import type { DocumentFieldOutput } from "@azure-rest/ai-document-intelligence";

/** A postal address as OCR read it. `country` only when Azure gave an ISO alpha-2 code. */
export interface OcrAddress {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  /** the address as printed on the document (the field's content), lines joined by ", " */
  text?: string;
}

/** A `currency` field's value: the amount and, when DI resolved it, the ISO code. */
export interface OcrCurrencyValue {
  amount: number;
  currencyCode?: string;
}

export type OcrFieldValue =
  | string
  | number
  | boolean
  | string[]
  | OcrCurrencyValue
  | OcrAddress
  | OcrField[]
  | OcrFieldMap
  | null;

/**
 * Where DI found a field (F141, D78 board *Documents*): its first bounding region — the page (1-based) and the
 * polygon's corners `[x1, y1, x2, y2, …]` in the page's own unit (`OcrPage.unit`: inches for a PDF, pixels for an
 * image). The review and the inbox draw a box there.
 */
export interface OcrBox {
  page: number;
  polygon: number[];
}

/** A page as DI measured it — the box polygons are in its unit. */
export interface OcrPage {
  page: number;
  width: number;
  height: number;
  unit: string;
}

/** One field as DI returned it. `type` is DI's (`string` · `date` · `currency` · `address` · `array` · `object` · …). */
export interface OcrField {
  type: string;
  /** by `type`: string / date / time → string, number / integer → number, currency → `{ amount, currencyCode }`,
   *  address → the flattened address, array → the entries (each an `OcrField`), object → a map; null when DI read
   *  the text but resolved no value */
  value: OcrFieldValue;
  /** DI's confidence of this field, null when it gave none (arrays, objects) */
  confidence: number | null;
  /** the field's text as printed */
  content: string | null;
  /** where it was printed (F141); absent on a reading before F141 — *Re-run OCR* adds it */
  box?: OcrBox | null;
}

export type OcrFieldMap = Record<string, OcrField>;

const clean = (s?: string) => (s?.trim() ? s.trim() : undefined);

/** An `address` field → its parts and its printed text; undefined when the field is missing or empty. */
export function extractAddressValue(field?: DocumentFieldOutput): OcrAddress | undefined {
  if (field?.type !== "address") return undefined;
  const v = field.valueAddress;
  const road = [v?.road, v?.houseNumber].map(clean).filter(Boolean).join(" ");
  const country = clean(v?.countryRegion)?.toUpperCase();
  const address: OcrAddress = {
    street: clean(v?.streetAddress) ?? clean(road),
    postalCode: clean(v?.postalCode),
    city: clean(v?.city),
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    text: clean(field.content?.replace(/\s*\n\s*/g, ", ")),
  };
  const kept = Object.fromEntries(Object.entries(address).filter(([, x]) => x !== undefined));
  return Object.keys(kept).length ? (kept as OcrAddress) : undefined;
}

function currencyValue(field: DocumentFieldOutput): OcrCurrencyValue | null {
  const v = field.valueCurrency;
  if (!v || typeof v.amount !== "number") return null;
  const code = v.currencyCode?.trim().toUpperCase();
  return code ? { amount: v.amount, currencyCode: code } : { amount: v.amount };
}

function fieldValue(field: DocumentFieldOutput): OcrFieldValue {
  switch (field.type) {
    case "string":
      return field.valueString ?? null;
    case "date":
      return field.valueDate ?? null;
    case "time":
      return field.valueTime ?? null;
    case "phoneNumber":
      return field.valuePhoneNumber ?? null;
    case "number":
      return field.valueNumber ?? null;
    case "integer":
      return field.valueInteger ?? null;
    case "boolean":
      return field.valueBoolean ?? null;
    case "selectionMark":
      return field.valueSelectionMark ?? null;
    case "countryRegion":
      return field.valueCountryRegion ?? null;
    case "signature":
      return field.valueSignature ?? null;
    case "selectionGroup":
      return field.valueSelectionGroup ?? null;
    case "currency":
      return currencyValue(field);
    case "address":
      return extractAddressValue(field) ?? null;
    case "array":
      return (field.valueArray ?? []).map(toOcrField);
    case "object":
      return mapDocumentFields(field.valueObject ?? {});
    default:
      return null;
  }
}

/** DI's first bounding region of a field → its box; null when DI gave none or a malformed one. */
export function boxOf(field: Pick<DocumentFieldOutput, "boundingRegions">): OcrBox | null {
  const region = field.boundingRegions?.[0];
  if (!region || typeof region.pageNumber !== "number" || !Array.isArray(region.polygon))
    return null;
  const polygon = region.polygon.filter((n) => typeof n === "number" && Number.isFinite(n));
  return polygon.length >= 4 && polygon.length % 2 === 0
    ? { page: region.pageNumber, polygon }
    : null;
}

function toOcrField(field: DocumentFieldOutput): OcrField {
  const box = boxOf(field);
  return {
    type: field.type,
    value: fieldValue(field),
    confidence: typeof field.confidence === "number" ? field.confidence : null,
    content: typeof field.content === "string" ? field.content : null,
    ...(box ? { box } : {}),
  };
}

/** DI's `documents[0].fields` → the map the app keeps: every field, nothing added, arrays kept as arrays. */
export function mapDocumentFields(fields: Record<string, DocumentFieldOutput>): OcrFieldMap {
  const out: OcrFieldMap = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field && typeof field.type === "string") out[name] = toOcrField(field);
  }
  return out;
}

// --- What the mapper types, per model: the DI field each typed key is read from, in the order the mapper tries ---

/** The keys of `OcrExtractedData` the mapper reads from one DI field (or a fallback chain of them). */
export type OcrTypedKey =
  | "vendorName"
  | "vendorTaxId"
  | "vendorAddress"
  | "invoiceDate"
  | "dueDate"
  | "invoiceTotal"
  | "subtotal"
  | "totalTax"
  | "invoiceNumber"
  | "customerName"
  | "customerTaxId"
  | "paymentDetails"
  | "merchantName"
  | "transactionDate"
  | "items";

const INVOICE_SOURCES: Partial<Record<OcrTypedKey, readonly string[]>> = {
  vendorName: ["VendorName", "VendorAddressRecipient"],
  vendorTaxId: ["VendorTaxId"],
  vendorAddress: ["VendorAddress"],
  invoiceDate: ["InvoiceDate"],
  dueDate: ["DueDate"],
  invoiceTotal: ["InvoiceTotal"],
  subtotal: ["SubTotal", "Subtotal"],
  totalTax: ["TotalTax"],
  invoiceNumber: ["InvoiceId"],
  customerName: ["CustomerName", "BillingAddressRecipient"],
  customerTaxId: ["CustomerTaxId"],
  paymentDetails: ["PaymentDetails"],
  items: ["Items"],
};

const RECEIPT_SOURCES: Partial<Record<OcrTypedKey, readonly string[]>> = {
  merchantName: ["MerchantName"],
  transactionDate: ["TransactionDate"],
  invoiceTotal: ["Total"],
  subtotal: ["SubTotal", "Subtotal"],
  totalTax: ["TotalTax"],
  items: ["Items"],
};

/** `mapAnalyzeResult`'s sources per model — the currency is not listed: it is taken from whichever amount carries a code. */
export const TYPED_SOURCES: Record<string, Partial<Record<OcrTypedKey, readonly string[]>>> = {
  "prebuilt-invoice": INVOICE_SOURCES,
  "prebuilt-receipt": RECEIPT_SOURCES,
};

type Reading = { fields?: OcrFieldMap; modelUsed: string } | null | undefined;

/**
 * DI's confidence of the field a typed value was read from — the first source present with a value, as the mapper
 * falls through (`VendorName`, else `VendorAddressRecipient`). Null when the document has no `fields` (read before
 * F127), the model types nothing by that key, or DI gave no confidence.
 */
export function fieldConfidence(reading: Reading, key: OcrTypedKey): number | null {
  const fields = reading?.fields;
  if (!fields) return null;
  for (const name of TYPED_SOURCES[reading.modelUsed]?.[key] ?? []) {
    const field = fields[name];
    if (field && field.value !== null) return field.confidence;
  }
  return null;
}

/** Where the field a typed value was read from was printed (F141) — the same fall-through as `fieldConfidence`. */
export function fieldBox(reading: Reading, key: OcrTypedKey): OcrBox | null {
  const fields = reading?.fields;
  if (!fields) return null;
  for (const name of TYPED_SOURCES[reading.modelUsed]?.[key] ?? []) {
    const field = fields[name];
    if (field && field.value !== null) return field.box ?? null;
  }
  return null;
}

function typedNames(modelUsed: string): Set<string> {
  return new Set(Object.values(TYPED_SOURCES[modelUsed] ?? {}).flat());
}

/** A field whose value is a list or a map — shown as *N entries*, its scalar children one level down, never flattened. */
export function isCompoundField(field: OcrField): boolean {
  return field.type === "array" || field.type === "object";
}

const byName = (a: [string, OcrField], b: [string, OcrField]) => a[0].localeCompare(b[0]);

/** The entries of a compound field: an array's items in order, or a map's `[name, field]` pairs by name. */
export function fieldEntries(field: OcrField): [string, OcrField][] {
  if (field.type === "array" && Array.isArray(field.value)) {
    return (field.value as OcrField[]).map((entry, i) => [String(i + 1), entry]);
  }
  if (field.type === "object" && field.value && typeof field.value === "object") {
    return Object.entries(field.value as OcrFieldMap).sort(byName);
  }
  return [];
}

/**
 * What the form does not show (*Also read*): the scalar fields the mapper does not type for this model, then every
 * array or object field (`Items`, `TaxDetails`, `PaymentDetails`) — those appear as *N entries* with their entries'
 * scalar children. Each group by name: JSONB hands the keys back in its own order, not DI's.
 */
export function alsoReadFields(reading: Reading): [string, OcrField][] {
  const fields = reading?.fields;
  if (!fields) return [];
  const typed = typedNames(reading.modelUsed);
  const rows = Object.entries(fields).filter(
    ([name, field]) => isCompoundField(field) || !typed.has(name),
  );
  const scalars = rows.filter(([, field]) => !isCompoundField(field)).sort(byName);
  const compounds = rows.filter(([, field]) => isCompoundField(field)).sort(byName);
  return [...scalars, ...compounds];
}

/** A field's one-line text: the printed content, else the value spelt out; empty when DI read nothing. */
export function fieldText(field: OcrField): string {
  if (field.content) return field.content.replace(/\s+/g, " ").trim();
  const v = field.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : "")).join(", ");
  if ("amount" in v && typeof v.amount === "number") {
    return v.currencyCode ? `${v.amount} ${v.currencyCode}` : String(v.amount);
  }
  if ("text" in v && typeof v.text === "string") return v.text;
  return "";
}
