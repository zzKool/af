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
  invoiceDate?: string;
  dueDate?: string;
  invoiceTotal?: number;
  subtotal?: number;
  totalTax?: number;
  currency?: string;
  invoiceNumber?: string;
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

export interface OcrLineItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  tax?: number;
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
        description: extractStringValue(obj.Description),
        quantity: extractNumberValue(obj.Quantity),
        unitPrice: extractCurrencyValue(obj.UnitPrice),
        amount: extractCurrencyValue(obj.Amount ?? obj.TotalPrice),
        tax: extractCurrencyValue(obj.Tax),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
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

      const doc = result.analyzeResult?.documents?.[0];
      const fields = doc?.fields;
      const rawText = result.analyzeResult?.content;
      const pageCount = result.analyzeResult?.pages?.length ?? 0;
      const confidence = doc?.confidence ?? 0;

      // Extract fields based on model type
      const isReceipt = modelId === "prebuilt-receipt";

      const data: OcrExtractedData = {
        // Invoice fields
        vendorName: isReceipt ? undefined : extractStringValue(fields?.VendorName),
        vendorTaxId: isReceipt ? undefined : extractStringValue(fields?.VendorTaxId),
        invoiceDate: isReceipt ? undefined : extractDateValue(fields?.InvoiceDate),
        dueDate: isReceipt ? undefined : extractDateValue(fields?.DueDate),
        invoiceTotal: isReceipt
          ? extractCurrencyValue(fields?.Total)
          : extractCurrencyValue(fields?.InvoiceTotal),
        subtotal: extractCurrencyValue(fields?.SubTotal ?? fields?.Subtotal),
        totalTax: extractCurrencyValue(fields?.TotalTax),
        currency: isReceipt ? undefined : extractStringValue(fields?.CurrencyCode),
        invoiceNumber: isReceipt ? undefined : extractStringValue(fields?.InvoiceId),
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
        invoiceTotal: 1250.0,
        subtotal: 1000.0,
        totalTax: 250.0,
        invoiceDate: "2026-03-14",
        currency: "SEK",
        invoiceNumber: "INV-2026-001",
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
export { MODEL_MAP, classifyQuality, MOCK_FIXTURES };
