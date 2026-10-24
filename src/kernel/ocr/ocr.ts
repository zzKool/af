import DocumentIntelligence, {
  type AnalyzeDocument202Response,
  type AnalyzeDocumentDefaultResponse,
  type AnalyzeOperationOutput,
  type DocumentFieldOutput,
  getLongRunningPoller,
  isUnexpected,
} from "@azure-rest/ai-document-intelligence";
import { logger } from "@/kernel/logging/logger";

// MUST NOT import from next/* or src/components/*

// --- Types ---

export type OcrSource =
  | { type: "url"; url: string }
  | { type: "buffer"; buffer: Buffer; mimeType: string };

export interface OcrService {
  analyzeDocument(source: OcrSource, prefixType: string): Promise<OcrResult>;
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
  confidence: number;
  modelUsed: string;
  pageCount: number;
  rawText?: string;
  processingTimeMs: number;
}

/** A postal address as OCR read it. `country` only when Azure gave an ISO alpha-2 code. */
export interface OcrAddress {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  /** the address as printed on the document (the field's content), lines joined by ", " */
  text?: string;
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

/** An `address` field → its parts and its printed text; undefined when the field is missing or empty. */
export function extractAddressValue(field?: DocumentFieldOutput): OcrAddress | undefined {
  if (field?.type !== "address") return undefined;
  const v = field.valueAddress;
  const clean = (s?: string) => (s?.trim() ? s.trim() : undefined);
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
    // Invoice fields
    vendorName: isReceipt ? undefined : extractStringValue(fields?.VendorName),
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
    async analyzeDocument(source: OcrSource, prefixType: string): Promise<OcrResult> {
      const modelId = MODEL_MAP[prefixType] ?? "prebuilt-layout";
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

const MOCK_FIXTURES: Record<string, { data: OcrExtractedData; quality: "high" | "low" | "none" }> =
  {
    invoice: {
      data: {
        vendorName: "Test Vendor AB",
        vendorTaxId: "SE556677889901",
        vendorAddress: {
          street: "Storgatan 1",
          postalCode: "111 22",
          city: "Stockholm",
          country: "SE",
          text: "Storgatan 1, 111 22 Stockholm, Sweden",
        },
        invoiceTotal: 1250.0,
        subtotal: 1000.0,
        totalTax: 250.0,
        invoiceDate: "2026-03-14",
        currency: "SEK",
        invoiceNumber: "INV-2026-001",
        customerName: "Dev AB",
        paymentDetails: [{ iban: "SE1234567890123456", swift: "NDEASESS" }],
        items: [
          {
            description: "Consulting",
            quantity: 10,
            unitPrice: 100,
            amount: 1000,
          },
        ],
        confidence: 0.95,
        modelUsed: "prebuilt-invoice",
        pageCount: 1,
        rawText: "Invoice from Test Vendor AB...",
        processingTimeMs: 1200,
      },
      quality: "high",
    },
    expense: {
      data: {
        merchantName: "ICA Maxi",
        invoiceTotal: 342.5,
        subtotal: 274.0,
        totalTax: 68.5,
        transactionDate: "2026-03-14",
        currency: "SEK",
        items: [{ description: "Groceries", amount: 342.5 }],
        confidence: 0.92,
        modelUsed: "prebuilt-receipt",
        pageCount: 1,
        rawText: "ICA Maxi Kvitto...",
        processingTimeMs: 800,
      },
      quality: "high",
    },
    contract: {
      data: {
        confidence: 0.8,
        modelUsed: "prebuilt-layout",
        pageCount: 2,
        rawText: "Service Agreement between...",
        processingTimeMs: 600,
      },
      quality: "none",
    },
    nda: {
      data: {
        confidence: 0.8,
        modelUsed: "prebuilt-layout",
        pageCount: 2,
        rawText: "Non-Disclosure Agreement...",
        processingTimeMs: 600,
      },
      quality: "none",
    },
    certificate: {
      data: {
        confidence: 0.8,
        modelUsed: "prebuilt-layout",
        pageCount: 2,
        rawText: "Certificate of Incorporation...",
        processingTimeMs: 600,
      },
      quality: "none",
    },
  };

export function createMockOcrService(): OcrService {
  return {
    async analyzeDocument(_source: OcrSource, prefixType: string): Promise<OcrResult> {
      const fixture = MOCK_FIXTURES[prefixType] ?? MOCK_FIXTURES.contract;

      if (!(prefixType in MOCK_FIXTURES)) {
        logger.warn({ prefixType }, "Unknown prefix type in mock OCR — using contract fixture");
      }

      return {
        success: true,
        data: structuredClone(fixture.data),
        rawResponse: { analyzeResult: { documents: [{ fields: {} }] } },
        quality: fixture.quality,
      };
    },
  };
}

// --- Factory ---

export function createOcrService(): OcrService {
  const endpoint = process.env.AZURE_DI_ENDPOINT;
  const apiKey = process.env.AZURE_DI_KEY;

  if (endpoint && apiKey) {
    return createAzureOcrService(endpoint, apiKey);
  }

  logger.warn("AZURE_DI_ENDPOINT not set — using mock OCR service");
  return createMockOcrService();
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
export { classifyQuality, MOCK_FIXTURES, MODEL_MAP };
