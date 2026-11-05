import DocumentIntelligence, {
  type AnalyzeDocument202Response,
  type AnalyzeDocumentDefaultResponse,
  type AnalyzeOperationOutput,
  type DocumentFieldOutput,
  getLongRunningPoller,
  isUnexpected,
} from "@azure-rest/ai-document-intelligence";
import { logger } from "@/kernel/logging/logger";
import { MOCK_RESPONSES, mockResponseFor } from "./__fixtures__/mock-responses";
import {
  extractAddressValue,
  mapDocumentFields,
  type OcrAddress,
  type OcrFieldMap,
} from "./fields";

// MUST NOT import from next/* or src/components/*

export type { OcrAddress, OcrCurrencyValue, OcrField, OcrFieldMap, OcrFieldValue } from "./fields";
export { extractAddressValue } from "./fields";

// --- Types ---

export type OcrSource =
  | { type: "url"; url: string; mimeType?: string | null }
  | { type: "buffer"; buffer: Buffer; mimeType: string };

/**
 * What the owner said the paper is when he dropped it on a bank row (D75): it picks the model over the file rule.
 * Absent on `/documents`, where nobody is asked and D52 / D69 rule.
 */
export type OcrPaper = "invoice" | "receipt";
export const OCR_PAPERS = ["invoice", "receipt"] as const satisfies readonly OcrPaper[];

export interface OcrService {
  analyzeDocument(source: OcrSource, prefixType: string, paper?: OcrPaper): Promise<OcrResult>;
}

export type OcrResult =
  | {
      success: true;
      data: OcrExtractedData;
      rawResponse: Record<string, unknown>;
      quality: "high" | "low" | "none";
    }
  | { success: false; error: string; retryable: boolean };

export interface OcrExtractedData {
  vendorName?: string;
  vendorTaxId?: string;
  /** Azure DI's `VendorAddress` (invoices): the parts it recognised, and the address as printed */
  vendorAddress?: OcrAddress;
  invoiceDate?: string;
  dueDate?: string;
  invoiceTotal?: number;
  subtotal?: number;
  totalTax?: number;
  currency?: string;
  invoiceNumber?: string;
  /** who the invoice is addressed to (Azure DI's `CustomerName`, else `BillingAddressRecipient`) and their VAT number */
  customerName?: string;
  customerTaxId?: string;
  /** the document says the buyer pays the VAT (reverse charge) — read from the text, any of en / fr / sv / de / it / es */
  reverseCharge?: boolean;
  merchantName?: string;
  transactionDate?: string;
  paymentDetails?: { iban?: string; swift?: string; bankName?: string }[];
  items?: OcrLineItem[];
  /**
   * Every field DI returned (F127): `{ type, value, confidence, content }` per field, arrays kept as arrays. The
   * typed keys above are read from the same map; the review page labels them with their field's confidence and
   * lists the rest under *Also read*. Absent on a layout reading and on documents read before F127 (`ocr-payload`
   * hands those back as `{}`; *Re-run OCR* fills it).
   */
  fields?: OcrFieldMap;
  confidence: number;
  modelUsed: string;
  pageCount: number;
  rawText?: string;
  processingTimeMs: number;
}

export interface OcrLineItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  tax?: number;
  /** the printed rate in percent (`25%` → 25; `0%[1]` → 0) */
  taxRate?: number;
}

// --- Model selection ---

const MODEL_MAP: Record<string, string> = {
  expense: "prebuilt-receipt",
  invoice: "prebuilt-invoice",
  contract: "prebuilt-layout",
  nda: "prebuilt-layout",
  certificate: "prebuilt-layout",
};

/** A PDF is a printed document (an invoice, a bill, an online receipt), never a photographed till receipt. */
const isPdf = (mimeType: string | null | undefined) =>
  mimeType?.toLowerCase() === "application/pdf";

const PAPER_MODEL: Record<OcrPaper, string> = {
  invoice: "prebuilt-invoice",
  receipt: "prebuilt-receipt",
};

/**
 * The Document Intelligence model a document is read with: the type decides (D52), the file refines it (D69):
 * an **expense** that is a PDF is an invoice-shaped document paid by card (a cloud bill, a subscription, an online
 * order) — the invoice model reads its vendor, VAT number and invoice number, which the receipt model never
 * does; the receipt model stays for the photographed till receipt (an image). A type change re-reads only when
 * the model differs. **On a bank row the owner's answer wins (D75)**: a `paper` given picks its model whatever
 * the file — a PDF till receipt he called *Receipt* is read by the receipt model; without one (`/documents`,
 * where nobody is asked) the file rule stands.
 */
export function ocrModelFor(
  prefixType: string,
  mimeType?: string | null,
  paper?: OcrPaper | null,
): string {
  if (paper) return PAPER_MODEL[paper];
  if (prefixType === "expense" && isPdf(mimeType)) return "prebuilt-invoice";
  return MODEL_MAP[prefixType] ?? "prebuilt-layout";
}

// --- Field extraction helpers (typed, no `any`) ---

function extractStringValue(field?: DocumentFieldOutput): string | undefined {
  return field?.type === "string" ? field.valueString : undefined;
}

/** A string field with its whitespace folded: Azure keeps the printed line breaks (`…(per seat)\nJul 27…`). */
function extractTextValue(field?: DocumentFieldOutput): string | undefined {
  const value = extractStringValue(field)?.replace(/\s+/g, " ").trim();
  return value ? value : undefined;
}

/**
 * The document's currency. Azure DI puts it inside each amount (`valueCurrency.currencyCode`) — there is no
 * document-level currency field — so the first ISO code among the given amounts wins; none → unknown, never a guess.
 */
export function extractCurrencyCode(
  fields: Record<string, DocumentFieldOutput> | undefined,
  keys: readonly string[],
): string | undefined {
  const amounts: (DocumentFieldOutput | undefined)[] = keys.map((k) => fields?.[k]);
  for (const item of extractArrayValue(fields?.Items) ?? []) {
    const obj = item.type === "object" ? item.valueObject : undefined;
    amounts.push(obj?.Amount, obj?.TotalPrice, obj?.UnitPrice, obj?.Price);
  }
  for (const field of amounts) {
    if (field?.type !== "currency") continue;
    const code = field.valueCurrency?.currencyCode?.trim().toUpperCase();
    if (code && /^[A-Z]{3}$/.test(code)) return code;
  }
  return undefined;
}

/** A line's tax rate in percent: `"25%"`, `"0%[1]"`, `"7,7 %"` or a number (a fraction ≤ 1 is read as such). */
export function extractTaxRate(field?: DocumentFieldOutput): number | undefined {
  if (field?.type === "number" && field.valueNumber !== undefined) {
    return field.valueNumber <= 1 ? Math.round(field.valueNumber * 10000) / 100 : field.valueNumber;
  }
  const match = extractStringValue(field)?.match(/(\d+(?:[.,]\d+)?)\s*%/);
  return match ? Number(match[1].replace(",", ".")) : undefined;
}

const REVERSE_CHARGE =
  /reverse[\s-]*charge|autoliquidation|omvänd\s+skattskyldighet|steuerschuldnerschaft\s+des\s+leistungsempfängers|inversione\s+contabile|inversión\s+del\s+sujeto\s+pasivo/i;

/** Does the document's text say the buyer pays the VAT? A flag for the owner and the accountant, no VAT computed. */
export function mentionsReverseCharge(text?: string): boolean {
  return !!text && REVERSE_CHARGE.test(text);
}

function extractCurrencyValue(field?: DocumentFieldOutput): number | undefined {
  if (field?.type === "currency") return field.valueCurrency?.amount;
  if (field?.type === "number") return field.valueNumber;
  return undefined;
}

function extractDateValue(field?: DocumentFieldOutput): string | undefined {
  return field?.type === "date" ? field.valueDate : undefined;
}

function extractNumberValue(field?: DocumentFieldOutput): number | undefined {
  if (field?.type === "number") return field.valueNumber;
  if (field?.type === "integer") return field.valueInteger;
  return undefined;
}

function extractArrayValue(field?: DocumentFieldOutput): DocumentFieldOutput[] | undefined {
  return field?.type === "array" ? field.valueArray : undefined;
}

// --- Quality classification ---

function classifyQuality(
  modelId: string,
  confidence: number,
  data: OcrExtractedData,
): "high" | "low" | "none" {
  // Non-financial doc (layout model) or zero documents → none
  if (modelId === "prebuilt-layout") return "none";

  const hasKeyField =
    data.vendorName !== undefined ||
    data.merchantName !== undefined ||
    data.invoiceTotal !== undefined;

  if (confidence >= 0.7 && hasKeyField) return "high";
  return "low";
}

// --- Extract payment details ---

function extractPaymentDetails(
  fields?: Record<string, DocumentFieldOutput>,
): { iban?: string; swift?: string; bankName?: string }[] | undefined {
  if (!fields) return undefined;
  const paymentDetailsField = fields.PaymentDetails;
  const items = extractArrayValue(paymentDetailsField);
  if (!items || items.length === 0) return undefined;

  return items
    .map((item) => {
      const obj = item.type === "object" ? item.valueObject : undefined;
      if (!obj) return null;
      return {
        iban: extractStringValue(obj.IBAN),
        swift: extractStringValue(obj.SWIFT),
        bankName: extractStringValue(obj.BankName),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
}

// --- Extract line items ---

function extractLineItems(fields?: Record<string, DocumentFieldOutput>): OcrLineItem[] | undefined {
  if (!fields) return undefined;
  const itemsField = fields.Items;
  const items = extractArrayValue(itemsField);
  if (!items || items.length === 0) return undefined;

  return items
    .map((item) => {
      const obj = item.type === "object" ? item.valueObject : undefined;
      if (!obj) return null;
      return {
        description: extractTextValue(obj.Description),
        quantity: extractNumberValue(obj.Quantity),
        unitPrice: extractCurrencyValue(obj.UnitPrice ?? obj.Price),
        amount: extractCurrencyValue(obj.Amount ?? obj.TotalPrice),
        tax: extractCurrencyValue(obj.Tax),
        taxRate: extractTaxRate(obj.TaxRate),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
}

/**
 * Azure DI's `analyzeResult` → the facts the app keeps. Pure, so it is tested on a stored response of the real shape
 * (`__fixtures__/azure-*.json`, invented values) rather than on the mock's own fixture.
 */
export function mapAnalyzeResult(
  analyzeResult: AnalyzeOperationOutput["analyzeResult"],
  modelId: string,
  processingTimeMs: number,
): { data: OcrExtractedData; quality: "high" | "low" | "none" } {
  const doc = analyzeResult?.documents?.[0];
  const fields = doc?.fields;
  const rawText = analyzeResult?.content;
  const pageCount = analyzeResult?.pages?.length ?? 0;
  const confidence = doc?.confidence ?? 0;

  // Extract fields based on model type
  const isReceipt = modelId === "prebuilt-receipt";

  const data: OcrExtractedData = {
    // Invoice fields — the vendor's name, else the name on its address block (`Microsoft AB` under `Microsoft`)
    vendorName: isReceipt
      ? undefined
      : (extractStringValue(fields?.VendorName) ??
        extractTextValue(fields?.VendorAddressRecipient)),
    vendorTaxId: isReceipt ? undefined : extractStringValue(fields?.VendorTaxId),
    vendorAddress: isReceipt ? undefined : extractAddressValue(fields?.VendorAddress),
    invoiceDate: isReceipt ? undefined : extractDateValue(fields?.InvoiceDate),
    dueDate: isReceipt ? undefined : extractDateValue(fields?.DueDate),
    invoiceTotal: isReceipt
      ? extractCurrencyValue(fields?.Total)
      : extractCurrencyValue(fields?.InvoiceTotal),
    subtotal: extractCurrencyValue(fields?.SubTotal ?? fields?.Subtotal),
    totalTax: extractCurrencyValue(fields?.TotalTax),
    currency: extractCurrencyCode(
      fields,
      isReceipt
        ? ["Total", "Subtotal", "TotalTax"]
        : ["InvoiceTotal", "AmountDue", "SubTotal", "Subtotal", "TotalTax"],
    ),
    invoiceNumber: isReceipt ? undefined : extractStringValue(fields?.InvoiceId),
    customerName: isReceipt
      ? undefined
      : (extractTextValue(fields?.CustomerName) ??
        extractTextValue(fields?.BillingAddressRecipient)),
    customerTaxId: isReceipt ? undefined : extractTextValue(fields?.CustomerTaxId),
    reverseCharge: mentionsReverseCharge(rawText) || undefined,
    // Receipt fields
    merchantName: isReceipt ? extractStringValue(fields?.MerchantName) : undefined,
    transactionDate: isReceipt ? extractDateValue(fields?.TransactionDate) : undefined,
    // Payment details (invoice only)
    paymentDetails: isReceipt ? undefined : extractPaymentDetails(fields),
    // Line items
    items: extractLineItems(fields),
    // Every field as DI returned it (F127) — the typed keys above are read from the same map
    fields: fields ? mapDocumentFields(fields) : undefined,
    // Metadata
    confidence,
    modelUsed: modelId,
    pageCount,
    rawText,
    processingTimeMs,
  };

  const quality = classifyQuality(modelId, confidence, data);
  return { data, quality };
}

// --- Azure DI Implementation ---

export function createAzureOcrService(endpoint: string, apiKey: string): OcrService {
  const client = DocumentIntelligence(endpoint, { key: apiKey });

  return {
    async analyzeDocument(
      source: OcrSource,
      prefixType: string,
      paper?: OcrPaper,
    ): Promise<OcrResult> {
      const modelId = ocrModelFor(prefixType, source.mimeType, paper);
      if (!(prefixType in MODEL_MAP)) {
        logger.warn(
          { prefixType, modelId },
          "Unknown prefix type — falling back to prebuilt-layout",
        );
      }

      const body: { urlSource?: string; base64Source?: string } =
        source.type === "url"
          ? { urlSource: source.url }
          : { base64Source: source.buffer.toString("base64") };

      const startMs = Date.now();

      let initialResponse: AnalyzeDocument202Response | AnalyzeDocumentDefaultResponse;
      try {
        initialResponse = await client.path("/documentModels/{modelId}:analyze", modelId).post({
          contentType: "application/json",
          body,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Azure DI API call failed";
        return { success: false, error: message, retryable: true };
      }

      if (isUnexpected(initialResponse)) {
        const status = initialResponse.status;
        const isAuthError = status === "401" || status === "403";
        return {
          success: false,
          error: `Azure DI API error: ${status}`,
          retryable: !isAuthError,
        };
      }

      let result: AnalyzeOperationOutput;
      try {
        const poller = getLongRunningPoller(client, initialResponse);
        result = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Azure DI polling failed";
        return { success: false, error: message, retryable: true };
      }

      const processingTimeMs = Date.now() - startMs;
      const { data, quality } = mapAnalyzeResult(result.analyzeResult, modelId, processingTimeMs);

      return {
        success: true,
        data,
        rawResponse: result.analyzeResult as unknown as Record<string, unknown>,
        quality,
      };
    },
  };
}

// --- Mock Implementation ---
//
// The mock is a stored DI response per model (`__fixtures__/mock-responses.ts`, invented values), picked by the
// same `ocrModelFor` as the real service — the type, the file and the paper answer weigh as they do on the box
// (lessons *F131 build*: a mock answering by the type alone hid that a PDF receipt was read by the invoice model)
// — and run through the same `mapAnalyzeResult`, so its `fields`, its typed subset and its `rawResponse` have the
// real shape by construction, and a field the mapper stops reading goes missing in the mock too (lessons
// 2026-10-24: the hand-written mock hid that the currency was never read).

export function createMockOcrService(): OcrService {
  return {
    async analyzeDocument(
      source: OcrSource,
      prefixType: string,
      paper?: OcrPaper,
    ): Promise<OcrResult> {
      const response = mockResponseFor(prefixType, ocrModelFor(prefixType, source.mimeType, paper));

      if (!(prefixType in MOCK_RESPONSES)) {
        logger.warn({ prefixType }, "Unknown prefix type in mock OCR — using contract fixture");
      }

      const analyzeResult = structuredClone(response.analyzeResult);
      const { data, quality } = mapAnalyzeResult(
        analyzeResult as unknown as AnalyzeOperationOutput["analyzeResult"],
        response.modelId,
        response.processingTimeMs,
      );
      return { success: true, data, rawResponse: analyzeResult, quality };
    },
  };
}

// --- The provider (F108, audit 2026-10-27 B3 / D5) ---
//
// The mock invents readings ("Test Vendor AB · 1 250.00 · INV-2026-001", quality *high*) that the inbox, the scorer
// and *Make it…* treat as read facts — so it runs only when asked for by name. A missing or mistyped Azure key is a
// configuration error the owner must see, never a silent fallback: the job fails non-retryable with the reason.

export type OcrProvider =
  | { kind: "azure"; endpoint: string; apiKey: string }
  | { kind: "mock" }
  | { kind: "none"; reason: string };

export const OCR_NOT_CONFIGURED_HINT =
  "set AZURE_DI_ENDPOINT and AZURE_DI_KEY, or OCR_PROVIDER=mock for invented readings (dev and tests only)";

export function resolveOcrProvider(
  env: Record<string, string | undefined> = process.env,
): OcrProvider {
  const wanted = env.OCR_PROVIDER?.trim().toLowerCase() || "azure";
  if (wanted === "mock") return { kind: "mock" };
  if (wanted !== "azure")
    return { kind: "none", reason: `unknown OCR_PROVIDER "${env.OCR_PROVIDER}"` };
  const endpoint = env.AZURE_DI_ENDPOINT?.trim();
  const apiKey = env.AZURE_DI_KEY?.trim();
  if (endpoint && apiKey) return { kind: "azure", endpoint, apiKey };
  const missing = [!endpoint && "AZURE_DI_ENDPOINT", !apiKey && "AZURE_DI_KEY"].filter(Boolean);
  return { kind: "none", reason: `${missing.join(" and ")} not set` };
}

/** Every call fails, non-retryable, with the configuration error — the document lands on *OCR failed* with the reason in the audit. */
export function createUnconfiguredOcrService(reason: string): OcrService {
  const error = `OCR is not configured (${reason}) — ${OCR_NOT_CONFIGURED_HINT}`;
  return {
    analyzeDocument: async () => ({ success: false, error, retryable: false }),
  };
}

export function createOcrService(
  env: Record<string, string | undefined> = process.env,
): OcrService {
  const provider = resolveOcrProvider(env);
  switch (provider.kind) {
    case "azure":
      return createAzureOcrService(provider.endpoint, provider.apiKey);
    case "mock":
      logger.warn("OCR_PROVIDER=mock — the OCR invents its readings; never on real documents");
      return createMockOcrService();
    case "none":
      logger.error(
        { reason: provider.reason },
        "OCR is not configured — every document will fail its OCR",
      );
      return createUnconfiguredOcrService(provider.reason);
  }
}

// --- Blob path extraction ---

export function extractBlobPath(blobUrl: string): string {
  // Strip query params (existing SAS tokens)
  const urlWithoutParams = blobUrl.split("?")[0];
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "documents";
  const containerIndex = urlWithoutParams.indexOf(`/${containerName}/`);
  if (containerIndex === -1) {
    throw new Error(`Cannot extract blob path from URL: ${blobUrl}`);
  }
  return urlWithoutParams.substring(containerIndex + containerName.length + 2);
}

// Exported for testing
export { classifyQuality, MODEL_MAP };
