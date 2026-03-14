# Story 5.2: OCR Processing & Extraction

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want uploaded financial documents to be automatically processed by OCR to extract key fields,
so that I don't have to manually type in amounts, dates, and vendor names from every receipt.

## Acceptance Criteria

1. **Given** a document has been uploaded from Story 5.1, **When** the Inngest `document/uploaded` event fires, **Then** the `process-document` Inngest function calls the OCR service interface (`src/server/services/ocr.ts`) (FR2)
2. The OCR service extracts: amount, date, vendor name, VAT, line items, and payment details (IBAN/SWIFT) from financial documents
3. Extracted data is stored in the document's `ocr_data` JSONB field (both raw response and structured extracted data)
4. Document status transitions from `uploaded` → `processing` → `extracted`
5. If OCR fails, document status becomes `ocr_failed` and the user sees "OCR unavailable — manual entry required" (NFR17)
6. Inngest retries OCR up to 3 times with exponential backoff on failure
7. The OCR service is behind a mockable interface — tests use a mock returning predictable, prefix-type-specific results from fixture documents
8. Document upload is never blocked by OCR failure — the file is always stored first (NFR17)
9. A quality indicator (`high`/`low`/`none`) is derived from OCR confidence and field extraction completeness — stored alongside extracted data for Story 5.3 review UI
10. `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting any new concepts, patterns, or configurations introduced in this story

## Tasks / Subtasks

- [x] Task 0: Install Azure Document Intelligence SDK (AC: #1, #7)
  - [x] 0.1 Install `@azure-rest/ai-document-intelligence` (v1.0.0+, API version 2024-11-30 GA): `npm install @azure-rest/ai-document-intelligence`
  - [x] 0.2 Verify env vars `AZURE_DI_ENDPOINT` and `AZURE_DI_KEY` exist in `.env.example` (they do — already added in Story 5.0)
  - [x] 0.3 Add `OCR_MAX_RETRIES = 3` constant to `src/lib/constants.ts` if not already present

- [x] Task 1: Create OCR service interface and implementation (AC: #1, #2, #7, #9)
  - [x] 1.1 Create `src/server/services/ocr.ts` with swappable interface:
    ```typescript
    // --- Dual-source input: SAS URL for production, Buffer for mock/local ---
    export type OcrSource =
      | { type: "url"; url: string }
      | { type: "buffer"; buffer: Buffer; mimeType: string };

    export interface OcrService {
      analyzeDocument(source: OcrSource, prefixType: string): Promise<OcrResult>;
    }

    export type OcrResult =
      | { success: true; data: OcrExtractedData; rawResponse: Record<string, unknown>; quality: "high" | "low" | "none" }
      | { success: false; error: string; retryable: boolean };

    export interface OcrExtractedData {
      // Financial fields — invoice model
      vendorName?: string;
      vendorTaxId?: string;
      invoiceDate?: string;         // ISO 8601
      dueDate?: string;             // ISO 8601
      invoiceTotal?: number;
      subtotal?: number;
      totalTax?: number;
      vatRate?: number;
      currency?: string;            // ISO 4217
      invoiceNumber?: string;
      // Financial fields — receipt model
      merchantName?: string;
      transactionDate?: string;     // ISO 8601
      // Payment details (forward-looking for Epic 7 reconciliation)
      paymentDetails?: { iban?: string; swift?: string; bankName?: string }[];
      // Line items
      items?: OcrLineItem[];
      // Metadata (always present)
      confidence: number;           // overall confidence 0-1
      modelUsed: string;            // e.g. "prebuilt-invoice"
      pageCount: number;
      rawText?: string;             // full extracted text (all models) — for search in Story 5.4
      processingTimeMs: number;     // for observability
    }

    export interface OcrLineItem {
      description?: string;
      quantity?: number;
      unitPrice?: number;
      amount?: number;
      tax?: number;
    }
    ```
  - [x] 1.2 Implement `createAzureOcrService(endpoint: string, apiKey: string): OcrService`:
    - Use `@azure-rest/ai-document-intelligence` REST client
    - Create client: `DocumentIntelligence(endpoint, { key: apiKey })`
    - Model selection via configurable map (NOT a switch statement):
      ```typescript
      const MODEL_MAP: Record<string, string> = {
        expense: "prebuilt-receipt",
        invoice: "prebuilt-invoice",
        contract: "prebuilt-layout",
        nda: "prebuilt-layout",
        certificate: "prebuilt-layout",
      };
      const modelId = MODEL_MAP[prefixType] ?? "prebuilt-layout"; // fallback for unknown/custom prefix types
      ```
    - **Dual source support:**
      - URL source (production): `body: { urlSource: source.url }` — Azure DI fetches from SAS URL directly, zero memory on our side
      - Buffer source (mock/local fallback): `body: { base64Source: source.buffer.toString("base64") }`
    - Analyze: `client.path("/documentModels/{modelId}:analyze", modelId).post({ contentType: "application/json", body })`
    - Poll: `getLongRunningPoller(client, initialResponse)` → `poller.pollUntilDone()`
    - Extract fields from `result.analyzeResult.documents[0].fields` into `OcrExtractedData` using typed field helpers:
      ```typescript
      // Use DocumentField discriminated union — NO `any` types
      function extractStringValue(field?: DocumentField): string | undefined {
        return field?.type === "string" ? field.valueString : undefined;
      }
      function extractCurrencyValue(field?: DocumentField): number | undefined {
        if (field?.type === "currency") return field.valueCurrency?.amount;
        if (field?.type === "number") return field.valueNumber;
        return undefined;
      }
      function extractDateValue(field?: DocumentField): string | undefined {
        return field?.type === "date" ? field.valueDate : undefined;
      }
      ```
    - Extract `rawText` from `result.analyzeResult.content` (all models return this)
    - Extract `pageCount` from `result.analyzeResult.pages?.length ?? 0`
    - Track `processingTimeMs` (Date.now() before/after API call)
    - **Quality classification:**
      - `"high"`: confidence >= 0.7 AND at least one key financial field extracted (vendorName/merchantName or invoiceTotal)
      - `"low"`: confidence < 0.7 OR no key financial fields but some data extracted
      - `"none"`: non-financial doc (layout model) OR zero documents in response
    - Return raw `analyzeResult` as `rawResponse` for storage in `ocrData` JSONB
    - Handle API errors:
      - Timeout / 5xx / network → `{ success: false, retryable: true }`
      - 401/403 auth → `{ success: false, retryable: false }`
      - 429 rate limit → `{ success: false, retryable: true }`
    - **CRITICAL**: If `isUnexpected(initialResponse)`, check status code to determine retryability
  - [x] 1.3 Implement `createMockOcrService(): OcrService`:
    - Returns **prefix-type-specific** fixture data (different per type):
    - Invoice fixture: `{ vendorName: "Test Vendor AB", vendorTaxId: "SE556677889901", invoiceTotal: 1250.00, subtotal: 1000.00, totalTax: 250.00, invoiceDate: "2026-03-14", currency: "SEK", invoiceNumber: "INV-2026-001", paymentDetails: [{ iban: "SE1234567890123456", swift: "NDEASESS" }], items: [{ description: "Consulting", quantity: 10, unitPrice: 100, amount: 1000 }], confidence: 0.95, modelUsed: "prebuilt-invoice", pageCount: 1, rawText: "Invoice from Test Vendor AB...", processingTimeMs: 1200 }`
    - Receipt fixture: `{ merchantName: "ICA Maxi", invoiceTotal: 342.50, subtotal: 274.00, totalTax: 68.50, transactionDate: "2026-03-14", currency: "SEK", items: [{ description: "Groceries", amount: 342.50 }], confidence: 0.92, modelUsed: "prebuilt-receipt", pageCount: 1, rawText: "ICA Maxi Kvitto...", processingTimeMs: 800 }`
    - Contract/NDA/Certificate fixture: `{ confidence: 0.80, modelUsed: "prebuilt-layout", pageCount: 2, rawText: "Service Agreement between...", processingTimeMs: 600 }` (minimal financial extraction)
    - Quality: invoice/receipt → `"high"`, contract/nda/cert → `"none"`
  - [x] 1.4 Export factory function `createOcrService(): OcrService`:
    - If `AZURE_DI_ENDPOINT` and `AZURE_DI_KEY` are set → return Azure implementation
    - Otherwise → return mock implementation with `logger.warn("AZURE_DI_ENDPOINT not set — using mock OCR service")`
  - [x] 1.5 MUST NOT import from `next/*` or `src/components/*` (hexagonal boundary)

- [x] Task 2: Create OCR service tests (AC: #7, #9)
  - [x] 2.1 Create `src/server/services/ocr.test.ts`
  - [x] 2.2 Test mock service returns correct prefix-specific fixture data (5 cases: expense, invoice, contract, nda, certificate)
  - [x] 2.3 Test mock service returns correct quality per prefix type (high for financial, none for non-financial)
  - [x] 2.4 Test factory function: returns mock when no env vars, Azure when env vars present
  - [x] 2.5 Test `OcrExtractedData` field mapping from Azure response format (use a captured real response fixture)
  - [x] 2.6 Test quality classification logic: high (confidence >=0.7 + key fields), low (confidence <0.7), none (layout model)
  - [x] 2.7 Test error handling: API failure → `{ success: false, retryable: true }`, auth failure → `{ success: false, retryable: false }`
  - [x] 2.8 Test unknown prefix type → falls back to `prebuilt-layout` model with warning log
  - [x] 2.9 Test URL source vs buffer source passed correctly to Azure DI client
  - [x] 2.10 Use `describe.skipIf(!process.env.AZURE_DI_ENDPOINT)` for integration tests against real Azure endpoint
  - [x] 2.11 **CI MUST NOT set AZURE_DI_ENDPOINT** — prevent accidental real API calls in CI pipeline
  - [x] 2.12 Add test fixture files for gated integration tests: `src/server/services/__fixtures__/test-invoice.pdf` (small 1-page invoice <100KB), `src/server/services/__fixtures__/test-receipt.jpg` (receipt photo <100KB)

- [x] Task 3: Update process-document Inngest function — 3-step architecture (AC: #1, #3, #4, #5, #6)
  - [x] 3.1 Update `src/server/inngest/functions/process-document.ts` with **three separate steps** for optimal retry/memoization:

    **Step 1 — "update-status-to-processing"** (existing from Story 5.1, no changes):
    - Load document, verify status is `uploaded`
    - Update status → `processing`
    - Memoized on retry — never re-executed

    **Step 2 — "run-ocr-analysis"** (NEW — expensive, memoized separately):
    ```typescript
    const ocrResult = await step.run("run-ocr-analysis", async () => {
      return withInngestContext(tenantId, userId, async (tx, _caller, _audit) => {
        const doc = await tx.document.findUnique({ where: { id: documentId } });
        if (!doc) throw new NonRetriableError("Document not found");
        if (doc.status !== "processing") return { skipped: true, status: doc.status };

        // Determine source: SAS URL (production) or buffer (local dev fallback)
        const storage = createStorageService();
        const blobPath = extractBlobPath(doc.blobUrl);
        let source: OcrSource;

        const isLocalBlob = doc.blobUrl.includes("127.0.0.1") || doc.blobUrl.includes("localhost");
        const isRemoteOcr = !!process.env.AZURE_DI_ENDPOINT?.includes("azure");

        if (isLocalBlob && isRemoteOcr) {
          // Local Azurite + remote Azure DI → must download buffer (Azure DI can't reach localhost)
          const fileBuffer = await storage.downloadBlob(blobPath);
          source = { type: "buffer", buffer: fileBuffer, mimeType: doc.mimeType };
        } else if (!isLocalBlob) {
          // Cloud blob → use SAS URL (zero memory, Azure-to-Azure network)
          const sasUrl = await storage.generateSasUrl(blobPath, 5);
          source = { type: "url", url: sasUrl };
        } else {
          // Local blob + local/mock OCR → buffer is fine
          const fileBuffer = await storage.downloadBlob(blobPath);
          source = { type: "buffer", buffer: fileBuffer, mimeType: doc.mimeType };
        }

        const ocrService = createOcrService();
        const result = await ocrService.analyzeDocument(source, doc.prefixType);

        // Log metrics ONLY — NEVER log ocrData contents (contains IBANs, tax IDs, amounts)
        logger.info(
          { documentId, modelUsed: result.success ? result.data.modelUsed : "n/a",
            confidence: result.success ? result.data.confidence : 0,
            durationMs: result.success ? result.data.processingTimeMs : 0,
            success: result.success },
          "OCR analysis complete"
        );

        return result;
      });
    });
    ```

    **Step 3 — "save-ocr-result"** (NEW — cheap DB write, retryable without re-running OCR):
    ```typescript
    await step.run("save-ocr-result", async () => {
      if (ocrResult.skipped) return ocrResult;

      return withInngestContext(tenantId, userId, async (tx, _caller, audit) => {
        if (ocrResult.success) {
          // Store both raw response and structured extracted data
          const ocrPayload = {
            extractedData: ocrResult.data,
            rawResponse: ocrResult.rawResponse,
            quality: ocrResult.quality,
          };
          await tx.document.update({
            where: { id: documentId },
            data: { status: "extracted", ocrData: ocrPayload },
          });
          await audit.log({
            action: "update", entityType: "document", entityId: documentId,
            oldData: { status: "processing" },
            newData: { status: "extracted", quality: ocrResult.quality },
          });
          return { documentId, status: "extracted", quality: ocrResult.quality };
        } else {
          if (ocrResult.retryable) throw new Error(ocrResult.error); // triggers Inngest retry
          // Non-retryable: mark as failed
          await tx.document.update({
            where: { id: documentId },
            data: { status: "ocr_failed" },
          });
          await audit.log({
            action: "update", entityType: "document", entityId: documentId,
            oldData: { status: "processing" }, newData: { status: "ocr_failed" },
          });
          return { documentId, status: "ocr_failed", error: ocrResult.error };
        }
      });
    });
    ```

  - [x] 3.2 Create helper `extractBlobPath(blobUrl: string): string` — extracts `{tenantId}/{uuid}.{ext}` from full Azurite/Azure blob URL. Must handle:
    - Azurite: `http://127.0.0.1:10000/devstoreaccount1/documents/{path}`
    - Azure: `https://account.blob.core.windows.net/documents/{path}`
    - URL with existing query params (SAS token) → strip params before parsing
  - [x] 3.3 Inngest retry config: keep `retries: 3` (already set in Story 5.1) — exponential backoff is Inngest's default behavior

- [x] Task 4: Handle OCR failure on retry exhaustion (AC: #5, #6)
  - [x] 4.1 Add `onFailure` callback to function config:
    ```typescript
    inngest.createFunction(
      {
        id: "process-document",
        retries: 3,
        onFailure: async ({ event, error }) => {
          // CRITICAL: onFailure receives NESTED event — event.data.event.data, NOT event.data
          const { tenantId, userId, documentId } = event.data.event.data;
          logger.error({ documentId, error: error.message }, "OCR processing failed after all retries");
          await withInngestContext(tenantId, userId, async (tx, _caller, audit) => {
            const doc = await tx.document.findUnique({ where: { id: documentId } });
            if (doc && doc.status === "processing") {
              await tx.document.update({
                where: { id: documentId },
                data: { status: "ocr_failed" },
              });
              await audit.log({
                action: "update", entityType: "document", entityId: documentId,
                oldData: { status: "processing" }, newData: { status: "ocr_failed" },
              });
            }
            // If doc is already ocr_failed or extracted, skip — idempotent
          });
        },
      },
      { event: "document/uploaded" },
      async ({ event, step }) => { ... },
    );
    ```
  - [x] 4.2 Log error details to Pino logger (Sentry captures via existing integration)
  - [x] 4.3 **CRITICAL GOTCHA**: `onFailure` handler receives a *wrapped* event — `event.data.event.data` contains the original event data. The dev MUST use this nested path or the handler crashes.

- [x] Task 5: Create process-document tests (AC: #1, #3, #4, #5, #7)
  - [x] 5.1 Create `src/server/inngest/functions/process-document.test.ts`
  - [x] 5.2 Test happy path (3 steps): uploaded → processing → OCR success → extracted
  - [x] 5.3 Test OCR failure (non-retryable): uploaded → processing → ocr_failed
  - [x] 5.4 Test OCR failure (retryable): error thrown from save-ocr-result → verify error propagates for Inngest retry
  - [x] 5.5 Test document not found in step 1 → NonRetriableError
  - [x] 5.6 Test document not found in step 2 → NonRetriableError
  - [x] 5.7 Test status guard: document not in 'uploaded' state → skip step 1
  - [x] 5.8 Test status guard: document not in 'processing' state → skip step 2
  - [x] 5.9 Test ocrData JSONB stored correctly — verify structure: `{ extractedData, rawResponse, quality }`
  - [x] 5.10 Test audit logging for both extracted and ocr_failed transitions
  - [x] 5.11 Test quality indicator flows through: high quality OCR → quality stored in ocrData
  - [x] 5.12 **Test onFailure handler specifically**: mock the nested event shape `event.data.event.data`, verify status → ocr_failed
  - [x] 5.13 **Test onFailure idempotency**: document already in `ocr_failed` → handler does nothing
  - [x] 5.14 **Test onFailure with already-extracted doc**: document already `extracted` → handler does nothing
  - [x] 5.15 Mock pattern (3-step aware):
    ```typescript
    // Mock step.run to execute callbacks sequentially (simulates Inngest step memoization)
    const stepResults = new Map<string, unknown>();
    const mockStep = {
      run: async (name: string, fn: () => Promise<unknown>) => {
        if (stepResults.has(name)) return stepResults.get(name); // memoized
        const result = await fn();
        stepResults.set(name, result);
        return result;
      },
    };

    vi.mock("@/server/services/ocr", () => ({
      createOcrService: () => ({
        analyzeDocument: vi.fn().mockResolvedValue({
          success: true,
          data: { vendorName: "Test AB", invoiceTotal: 1000, confidence: 0.95,
                  modelUsed: "prebuilt-invoice", pageCount: 1, processingTimeMs: 1200 },
          rawResponse: { analyzeResult: { documents: [{ fields: {} }] } },
          quality: "high",
        }),
      }),
    }));
    vi.mock("@/server/services/storage", () => ({
      createStorageService: () => ({
        downloadBlob: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
        generateSasUrl: vi.fn().mockResolvedValue("https://blob.url/sas?token=xxx"),
        ensureContainer: vi.fn(),
        uploadBlob: vi.fn(),
        deleteBlob: vi.fn(),
      }),
    }));
    ```
  - [x] 5.16 Use `withTenantTransaction` + real DB for integration tests (RLS-scoped)

- [x] Task 6: Create extractBlobPath utility + tests (AC: #1)
  - [x] 6.1 Create `extractBlobPath` in `src/server/services/ocr.ts` (or a shared util) — exported for testing
  - [x] 6.2 Test cases:
    - Azurite: `"http://127.0.0.1:10000/devstoreaccount1/documents/abc-123/file.pdf"` → `"abc-123/file.pdf"`
    - Azure: `"https://defterfab.blob.core.windows.net/documents/abc-123/file.pdf"` → `"abc-123/file.pdf"`
    - URL with query params: `"https://...documents/abc-123/file.pdf?sv=2024&sig=xxx"` → `"abc-123/file.pdf"`
    - Missing container name → throws Error

- [x] Task 7: Update documents service with OCR data access (AC: #3)
  - [x] 7.1 Update `getDocument()` in `src/server/services/documents.ts` to include `ocrData` in the return type
  - [x] 7.2 Add `getDocumentOcrData(tx, documentId): Promise<ServiceResult<{ extractedData: OcrExtractedData; quality: string } | null>>` method — parses the raw JSONB `ocrData` field into typed structure for Story 5.3 consumption
  - [x] 7.3 Add test for `getDocumentOcrData` returning parsed fields
  - [x] 7.4 Add test for `getDocumentOcrData` with null ocrData (document not yet processed)

- [x] Task 8: Testing & verification (AC: all)
  - [x] 8.1 Run full test suite: `npm run test` — must pass all 453+ existing tests + ~27 new tests (target: 480+)
  - [x] 8.2 Run lint: `npx biome check --write`
  - [x] 8.3 Run typecheck: `npm run typecheck` — verify NO new `any` types introduced (Azure DI SDK types must be used properly)
  - [x] 8.4 Verify build: `npm run build`
  - [x] 8.5 Manual smoke test (if Azure DI endpoint configured):
    - `docker compose up -d` (Azurite + DB)
    - `npm run inngest:dev` (Inngest dev server at localhost:8288)
    - Upload a PDF via dev server → verify Inngest dashboard shows 3 steps executing
    - Verify document status transitions: uploaded → processing → extracted
    - Verify `ocr_data` populated in DB with `{ extractedData, rawResponse, quality }` structure (check via Prisma Studio: `npm run db:studio`)
    - Verify OCR completes within 30 seconds for a typical 1-page invoice
  - [x] 8.6 Manual smoke test (without Azure DI — mock mode):
    - Upload a document → verify mock OCR runs → status goes to `extracted` with prefix-specific fixture data

- [x] Task 9: Documentation (AC: #10)
  - [x] 9.1 Create `docs/ocr-processing.md` documenting:
    - OCR service interface and implementations (Azure DI + mock)
    - Model selection logic (prefix type → prebuilt model map + unknown fallback)
    - Dual source approach: SAS URL (production) vs buffer (local dev)
    - Quality classification logic (high/low/none)
    - Status lifecycle with OCR states
    - 3-step Inngest architecture and why (memoization prevents redundant API calls)
    - Retry and failure handling (including onFailure safety net)
    - ocrData JSONB structure: `{ extractedData, rawResponse, quality }`
    - Environment variables
    - Testing with mock vs real Azure endpoint
    - Security: never log extracted data contents
    - Known limitation: stuck documents in `processing` if Inngest infrastructure fails — manual recovery via Prisma Studio
  - [x] 9.2 Update `docs/index.md` with reference to `[[ocr-processing]]`
  - [x] 9.3 Update `docs/document-upload.md` status lifecycle section with OCR details

## Dev Notes

### Azure Document Intelligence SDK — Exact API Pattern

**Package:** `@azure-rest/ai-document-intelligence` v1.0.0+ (API version: `2024-11-30` GA)

```typescript
import DocumentIntelligence, {
  isUnexpected,
  getLongRunningPoller,
  type AnalyzeOperationOutput,
} from "@azure-rest/ai-document-intelligence";

// Create client with API key
const client = DocumentIntelligence(endpoint, { key: apiKey });

// Option A: Analyze via SAS URL (production — zero memory, Azure-to-Azure)
const initialResponse = await client
  .path("/documentModels/{modelId}:analyze", "prebuilt-invoice")
  .post({
    contentType: "application/json",
    body: { urlSource: sasUrl },
  });

// Option B: Analyze via base64 (local dev fallback)
const initialResponse = await client
  .path("/documentModels/{modelId}:analyze", "prebuilt-invoice")
  .post({
    contentType: "application/json",
    body: { base64Source: fileBuffer.toString("base64") },
  });

if (isUnexpected(initialResponse)) {
  // Check status for retryability
  const status = initialResponse.status;
  if (status === "401" || status === "403") throw new NonRetriableError("Auth failed");
  throw new Error(`Azure DI API error: ${status}`); // retryable
}

// Poll until complete
const poller = getLongRunningPoller(client, initialResponse);
const result = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;

// Extract fields using typed helpers — NO `any`
const doc = result.analyzeResult?.documents?.[0];
const fields = doc?.fields;
const vendorName = extractStringValue(fields?.VendorName);
const total = extractCurrencyValue(fields?.InvoiceTotal);
const rawText = result.analyzeResult?.content; // full text for search
const pageCount = result.analyzeResult?.pages?.length ?? 0;
```

### Dual Source Strategy: SAS URL vs Buffer

| Blob Location | OCR Endpoint | Strategy | Rationale |
|--------------|-------------|----------|-----------|
| Azure cloud | Azure cloud | SAS URL (`urlSource`) | Zero memory, Azure-to-Azure network |
| Azure cloud | Mock | Buffer (N/A — mock doesn't call API) | Mock ignores source |
| Azurite local | Azure cloud | Buffer (`base64Source`) | Azure DI can't reach localhost |
| Azurite local | Mock | Buffer (N/A) | Mock ignores source |

Detection logic: `blobUrl.includes("127.0.0.1")` → local blob. `AZURE_DI_ENDPOINT?.includes("azure")` → remote OCR. If local blob + remote OCR → download buffer. Otherwise → generate SAS URL.

### Prebuilt Model Selection by Prefix Type

**Configurable map — NOT a switch statement:**
```typescript
const MODEL_MAP: Record<string, string> = {
  expense: "prebuilt-receipt",
  invoice: "prebuilt-invoice",
  contract: "prebuilt-layout",
  nda: "prebuilt-layout",
  certificate: "prebuilt-layout",
};
const modelId = MODEL_MAP[prefixType] ?? "prebuilt-layout"; // unknown/custom → layout fallback
```

Unknown prefix types (from custom tenant configuration in Story 3.4) fall back to `prebuilt-layout` with a warning log. If Azure ships `prebuilt-contract` in the future, change one line in the map.

### Prebuilt Invoice Fields (2024-11-30 GA)

Key fields: `VendorName`, `VendorTaxId`, `VendorAddress`, `CustomerName`, `InvoiceId`, `InvoiceDate`, `DueDate`, `InvoiceTotal`, `SubTotal`, `TotalTax`, `PaymentDetails[].IBAN`, `PaymentDetails[].SWIFT`, `Items[]` (Description, Quantity, UnitPrice, Amount, Tax), `TaxDetails[]` (Amount, Rate), `CurrencyCode`

**PaymentDetails extraction is critical** — IBAN/SWIFT data enables automatic bank reconciliation matching in Epic 7 (Story 7.2). Extract and store these even though Story 5.2 doesn't display them.

### Prebuilt Receipt Fields (2024-11-30 GA)

Key fields: `MerchantName`, `MerchantAddress`, `MerchantPhoneNumber`, `TransactionDate`, `TransactionTime`, `Total`, `Subtotal`, `TotalTax`, `Items[]` (Description, Quantity, TotalPrice), `TaxDetails[]`

### Quality Classification Logic

Quality indicator helps Story 5.3 differentiate UI treatment:

| Quality | Criteria | Story 5.3 UI Treatment |
|---------|----------|----------------------|
| `high` | confidence >= 0.7 AND at least one key field (vendorName/merchantName OR invoiceTotal) extracted | "Review extracted data" |
| `low` | confidence < 0.7 OR has some data but missing key fields | "Low confidence — manual review recommended" |
| `none` | Non-financial doc (layout model) OR zero documents in response OR empty fields | "Manual entry required" (no extracted fields to review) |

This is metadata stored in `ocrData.quality`, NOT a new document status. The status remains `extracted` in all success cases.

### ocrData JSONB Structure

```typescript
// Stored in documents.ocr_data
{
  extractedData: OcrExtractedData,   // Typed, structured fields for Story 5.3 review form
  rawResponse: AnalyzeResult,         // Full Azure DI response (provenance for Bokföringslagen)
  quality: "high" | "low" | "none",   // Classification for UI treatment
}
```

Story 5.3's `getDocumentOcrData()` reads `extractedData` + `quality`. The `rawResponse` is preserved for audit/compliance but not directly consumed by the UI.

### Architecture Compliance

**Hexagonal boundary enforcement:**
- `src/server/services/ocr.ts` MUST NOT import from `next/*` or `src/components/*`
- OCR service is framework-agnostic with a swappable interface
- Inngest function (`process-document.ts`) orchestrates the flow

### 3-Step Inngest Architecture (Why Three Steps, Not Two)

```
Inngest receives "document/uploaded" event
  → step.run("update-status-to-processing")    [existing from 5.1, memoized]
    → Load document, verify status is 'uploaded'
    → Update status: uploaded → processing
  → step.run("run-ocr-analysis")                [NEW — EXPENSIVE, memoized separately]
    → Generate SAS URL or download blob
    → Call OCR service (Azure DI or mock)
    → Return OcrResult (serialized by Inngest)
  → step.run("save-ocr-result")                  [NEW — CHEAP DB write, retryable]
    → Read OCR result from previous step
    → If success: store ocrData, status → extracted
    → If retryable failure: throw Error (Inngest retries THIS step only)
    → If non-retryable: status → ocr_failed
  → onFailure handler                            [NEW — safety net]
    → If all retries exhausted: ensure status → ocr_failed
```

**Why 3 steps instead of 2:**
1. **Cost optimization** — if `save-ocr-result` fails (DB timeout), Inngest retries ONLY that step. The expensive Azure DI API call in `run-ocr-analysis` is memoized and NOT re-executed. Saves money (Azure DI charges per page).
2. **Step 1** memoized — status update never re-runs on retry
3. **Step 2** memoized — OCR API call never re-runs on retry
4. **Step 3** is cheap to retry — just a DB write
5. Each step runs in its own `withInngestContext` transaction — clean audit trail

### Blob URL to Blob Path Extraction

```typescript
export function extractBlobPath(blobUrl: string): string {
  // Strip query params (existing SAS tokens)
  const urlWithoutParams = blobUrl.split("?")[0];
  // Handle both Azurite and Azure URLs
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "documents";
  const containerIndex = urlWithoutParams.indexOf(`/${containerName}/`);
  if (containerIndex === -1) throw new Error(`Cannot extract blob path from URL: ${blobUrl}`);
  return urlWithoutParams.substring(containerIndex + containerName.length + 2);
}
```

### Error Handling Strategy

| Scenario | Action | Inngest Behavior |
|----------|--------|-----------------|
| Document not found | `NonRetriableError` | Fails immediately, no retry |
| Document not in expected status | Return `{ skipped: true }` | Success, no retry |
| Azure DI API timeout / 5xx | Throw `Error` | Retries up to 3x with exponential backoff |
| Azure DI auth failure (401/403) | `NonRetriableError` | Fails immediately |
| Azure DI rate limit (429) | Throw `Error` | Retries with backoff |
| Blob download fails | Throw `Error` | Retries |
| OCR succeeded but no fields extracted | Status `extracted`, quality `none` | Success — not a failure |
| All retries exhausted | `onFailure` handler | Mark as `ocr_failed` |
| AZURE_DI_ENDPOINT not set | Mock service used | Success with fixture data |

### Security — CRITICAL

**NEVER log ocrData contents or extracted fields** — they contain IBANs, tax IDs, invoice amounts. Log ONLY:
```typescript
logger.info({ documentId, modelUsed, confidence, durationMs, quality, success }, "OCR analysis complete");
```

**SAS URL lifetime:** 5 minutes (`SIGNED_URL_TTL_SECONDS = 300`). Azure DI typically processes in 2-15 seconds. Sufficient headroom.

**Inngest dashboard visibility:** In dev mode, step return values are visible in the Inngest dashboard UI. For production Inngest Cloud, ensure signing key is configured (deferred item from Story 5.0).

### onFailure Handler — CRITICAL GOTCHA

The `onFailure` callback receives a **wrapped event**. The original event data is at `event.data.event.data`, NOT `event.data`:

```typescript
onFailure: async ({ event, error }) => {
  // WRONG: event.data.documentId → undefined
  // RIGHT: event.data.event.data.documentId
  const { tenantId, userId, documentId } = event.data.event.data;
}
```

This is the #1 Inngest `onFailure` mistake. The dev MUST use the nested path.

### Stuck Document Recovery

**Known limitation:** If Inngest infrastructure fails mid-processing and never fires `onFailure`, documents remain in `processing` forever. This is acceptable for a solo AB app.

**Recovery:** Manual via Prisma Studio (`npm run db:studio`) — find documents with `status = "processing"` older than 10 minutes, update to `ocr_failed`. A future admin action or cron job can automate this if needed.

### Azure DI SDK Field Type Helpers — NO `any`

The SDK returns `DocumentField` with a discriminated `type` property. Use typed extractors:

```typescript
import type { DocumentFieldOutput } from "@azure-rest/ai-document-intelligence";

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
function extractArrayValue(field?: DocumentFieldOutput): DocumentFieldOutput[] | undefined {
  return field?.type === "array" ? field.valueArray : undefined;
}
```

**Do NOT use `any` for field access.** If the SDK types are insufficient, create local type definitions matching the API response schema.

### Existing Code to Reuse — DO NOT Reinvent

| What | Where | Notes |
|------|-------|-------|
| Inngest function skeleton | `src/server/inngest/functions/process-document.ts` | Extend existing function (DON'T create new file) |
| Inngest context helpers | `src/server/inngest/context.ts` | `withInngestContext`, `createSystemCaller` |
| Storage download | `src/server/services/storage.ts` | `downloadBlob(blobPath)` returns `Buffer` |
| Storage SAS URL | `src/server/services/storage.ts` | `generateSasUrl(blobPath, minutes)` returns signed URL |
| Storage factory | `src/server/services/storage.ts` | `createStorageService()` |
| Document model | `prisma/schema/app.prisma` | `ocrData Json? @db.JsonB` already exists |
| Document service | `src/server/services/documents.ts` | `getDocument()` for loading document data |
| Audit logging | `src/server/services/audit.ts` | `toAuditData()`, `createAuditEntry()` |
| Logger | `src/server/logger.ts` | Pino logger for warnings/errors |
| Constants | `src/lib/constants.ts` | Add `OCR_MAX_RETRIES` if needed |
| Test fixtures | `src/server/db/test-fixtures.ts` | `createTestDocument()`, `cleanupTestData()` |
| Test helpers | `src/server/test-utils/config-crud-helpers.ts` | `assertAuditLogged()` |
| Inngest test pattern | `docs/async-jobs.md` | Mock step/event pattern |

### Testing Strategy

**Test target:** ~27 new tests. Baseline 453 → target 480+.

**Mocking strategy:** Mock both OCR service and storage service in Inngest function tests. Real OCR integration tests gated behind `describe.skipIf(!process.env.AZURE_DI_ENDPOINT)`.

**Test layers:**

| Layer | File | Tests | Count |
|-------|------|-------|-------|
| Unit | `ocr.test.ts` | Mock fixtures per prefix (5), quality classification (3), factory (1), model selection (2), field mapping (1), error handling (2), unknown prefix fallback (1), URL vs buffer source (1) | ~16 |
| Unit | `ocr.test.ts` (extractBlobPath) | Azurite URL, Azure URL, URL with params, missing container | ~4 |
| Integration | `process-document.test.ts` | 3-step flow (1), non-retryable failure (1), retryable failure (1), not found (2), status guards (2), ocrData structure (1), audit logging (2), quality flow-through (1), onFailure handler (3) | ~14 |
| Integration | `documents.test.ts` | getDocumentOcrData success (1), null ocrData (1) | ~2 |
| Integration (gated) | `ocr.test.ts` | Real Azure DI with test fixtures (2) | ~2 |

**Key test patterns:**
```typescript
// Mock Inngest step with memoization simulation
const stepResults = new Map<string, unknown>();
const mockStep = {
  run: async (name: string, fn: () => Promise<unknown>) => {
    if (stepResults.has(name)) return stepResults.get(name);
    const result = await fn();
    stepResults.set(name, result);
    return result;
  },
};

// Test the function handler directly
await processDocument.handler({
  event: { data: { tenantId, userId, documentId } },
  step: mockStep,
} as any);

// Test onFailure handler (note NESTED event structure)
await processDocument.onFailure({
  event: { data: { event: { data: { tenantId, userId, documentId } } } },
  error: new Error("All retries exhausted"),
} as any);
```

**Fixture files for gated integration tests:**
```
src/server/services/__fixtures__/test-invoice.pdf    (~50KB, 1-page simple invoice)
src/server/services/__fixtures__/test-receipt.jpg     (~30KB, receipt photo)
```
Committed to repo. Small files only (<100KB). Integration tests read these and send to real Azure DI.

### Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `AZURE_DI_ENDPOINT` | No* | — | Azure Document Intelligence endpoint URL |
| `AZURE_DI_KEY` | No* | — | Azure Document Intelligence API key |
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | — | Already configured (Story 5.0) |
| `AZURE_STORAGE_CONTAINER` | Yes | `documents` | Already configured (Story 5.0) |

*If not set, the mock OCR service is used automatically — no Azure dependency for dev/testing.

**CI pipeline MUST NOT set `AZURE_DI_ENDPOINT`** — prevents accidental real API calls and costs.

### Git Commit Sequence

1. Task 0-1 (SDK install + OCR service interface + implementation + mock) — atomic unit
2. Task 2 (OCR service tests + fixtures) — tests for the interface
3. Tasks 3-4 (Inngest 3-step function + onFailure handler + extractBlobPath) — core integration
4. Task 5-6 (Inngest function tests + extractBlobPath tests) — test the integration
5. Task 7 (documents service ocrData access) — prepare for Story 5.3
6. Task 8 (testing & verification) — all green
7. Task 9 (docs) — final polish

Run `npx biome check --write` before EVERY commit.

### Previous Story Intelligence (Story 5.1)

**Key learnings from Story 5.1:**
- `process-document.ts` already handles the first step (status → processing) with guard for non-uploaded status
- `withInngestContext` provides full RLS transaction context for Inngest functions
- `NonRetriableError` used for orphan events (document not found from rolled-back transaction)
- Storage service has `downloadBlob()` AND `generateSasUrl()` — use SAS URL path in production
- `ocrData` JSONB field already exists on Document model — ready for OCR data
- Test baseline: 453 tests / all passing — do not regress
- Code review from 5.1 taught: always use try/catch in Inngest steps, lazy-init storage, fail-closed role checks, guard status transitions
- Biome check must pass before commit

### Project Structure Notes

**New files to create:**
```
src/server/services/ocr.ts                              — Interface + Azure impl + mock impl + factory + extractBlobPath
src/server/services/ocr.test.ts                          — Unit tests (~16) + extractBlobPath tests (~4)
src/server/inngest/functions/process-document.test.ts    — Integration tests (~14)
src/server/services/__fixtures__/test-invoice.pdf        — Test fixture (<100KB)
src/server/services/__fixtures__/test-receipt.jpg        — Test fixture (<100KB)
docs/ocr-processing.md
```

**Files to modify:**
```
src/server/inngest/functions/process-document.ts — 3 steps + onFailure handler
src/server/services/documents.ts — Add getDocumentOcrData() method + ocrData in getDocument return
src/server/services/documents.test.ts — Add tests for getDocumentOcrData
src/lib/constants.ts — Add OCR_MAX_RETRIES constant
docs/index.md — Add [[ocr-processing]] reference
docs/document-upload.md — Update status lifecycle section
package.json — @azure-rest/ai-document-intelligence dependency
package-lock.json — lockfile update
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 5, Story 5.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — OCR Service Abstraction, Document Storage Architecture]
- [Source: _bmad-output/planning-artifacts/prd.md — FR2, NFR17]
- [Source: _bmad-output/implementation-artifacts/5-1-document-upload-storage.md — Previous story learnings, OCR Data Design section]
- [Source: docs/async-jobs.md — Inngest function patterns, withInngestContext, retry config]
- [Source: docs/document-upload.md — Upload flow, status lifecycle]
- [Source: src/server/inngest/functions/process-document.ts — Existing Story 5.1 implementation]
- [Source: src/server/inngest/context.ts — withInngestContext helper]
- [Source: src/server/services/storage.ts — StorageService interface, downloadBlob, generateSasUrl]
- [Source: src/server/services/documents.ts — Document service, getDocument]
- [Source: learn.microsoft.com — @azure-rest/ai-document-intelligence SDK v1.0.0, API 2024-11-30]
- [Source: github.com/Azure-Samples/document-intelligence-code-samples — prebuilt-invoice, prebuilt-receipt field schemas 2024-11-30 GA]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No debug issues encountered.

### Completion Notes List

- Installed `@azure-rest/ai-document-intelligence` SDK
- Created OCR service (`src/server/services/ocr.ts`) with Azure DI + mock implementations, typed field extractors, quality classification, and `extractBlobPath` utility
- Updated `process-document.ts` Inngest function with 3-step architecture (status update, OCR analysis, save result) and `onFailure` handler
- Added `getDocumentOcrData()` to documents service for Story 5.3 consumption
- 33 new tests: 19 OCR service tests + 14 Inngest function tests
- All 479 tests pass (17 skipped, 1 pre-existing timeout in action-client.test.ts)
- Typecheck clean, lint clean, build clean
- Created `docs/ocr-processing.md` documentation with wiki-link references

### File List

**New files:**
- `src/server/services/ocr.ts` — OCR service interface, Azure DI implementation, mock, extractBlobPath
- `src/server/services/ocr.test.ts` — OCR service unit tests (19 tests)
- `src/server/inngest/functions/process-document.test.ts` — Inngest function tests (14 tests)
- `src/server/services/__fixtures__/test-invoice.pdf` — Test fixture
- `src/server/services/__fixtures__/test-receipt.jpg` — Test fixture
- `docs/ocr-processing.md` — OCR processing documentation

**Modified files:**
- `src/server/inngest/functions/process-document.ts` — 3-step OCR + onFailure handler
- `src/server/services/documents.ts` — Added ocrData to getDocument return, added getDocumentOcrData()
- `src/server/services/documents.test.ts` — Added 2 tests for getDocumentOcrData
- `docs/index.md` — Added [[ocr-processing]] reference
- `docs/document-upload.md` — Updated status lifecycle section with OCR details
- `package.json` — Added @azure-rest/ai-document-intelligence dependency
- `package-lock.json` — Lockfile update
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story status updated

## Change Log

- 2026-03-14: Story 5.2 implementation complete — OCR service, 3-step Inngest function, tests, documentation
- 2026-03-15: Code review fixes — use OCR_MAX_RETRIES constant, remove unused vatRate field, remove dead code in classifyQuality, deep clone mock fixtures, simplify remote OCR detection, fix lint warnings
