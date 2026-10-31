# OCR Processing

## Overview

Documents uploaded via Story 5.1 are automatically processed by Azure Document Intelligence (or a mock service) to extract financial fields. The OCR pipeline runs as a resumable [[async-jobs|pg-boss job]] (`documents.process-document`): the job carries ids, the document's status drives what each attempt does.

## OCR Service Interface

The service is defined in `src/kernel/ocr/ocr.ts` with a swappable interface:

```typescript
interface OcrService {
  analyzeDocument(source: OcrSource, prefixType: string): Promise<OcrResult>;
}
```

Two implementations:
- **Azure DI** (`createAzureOcrService`) — calls Azure Document Intelligence REST API
- **Mock** (`createMockOcrService`) — returns prefix-specific fixture data for development/testing

The factory function `createOcrService()` selects automatically based on whether `AZURE_DI_ENDPOINT` and `AZURE_DI_KEY` environment variables are set.

## Model Selection

Prefix types map to Azure DI prebuilt models (`ocrModelFor(prefixType, mimeType)`); **the type decides (D52), the file refines it (D69, 2026-10-29)**: an *expense* that is a **PDF** is read with the invoice model — a cloud bill, a subscription, an online order paid by card is printed like an invoice, and only that model reads the vendor's name, VAT number and invoice number; the receipt model stays for the photographed till receipt (an image). A type change re-reads only when the model differs, so *expense ↔ invoice* on a PDF swaps the key and keeps the reading.

| Prefix Type | Model | Fields Extracted |
|-------------|-------|-----------------|
| expense (image) | prebuilt-receipt | MerchantName, Total, TotalTax, TransactionDate, Items (Description, Quantity, Price, TotalPrice); the currency from the amounts |
| expense (PDF) | prebuilt-invoice | as *invoice* below |
| invoice | prebuilt-invoice | VendorName (else VendorAddressRecipient — the name on the vendor's address block), VendorTaxId, VendorAddress (→ `vendorAddress`: street, postal code, city, ISO-2 country, the printed text — `extractAddressValue`), InvoiceTotal, SubTotal, TotalTax, InvoiceDate, DueDate, InvoiceId, CustomerName (else BillingAddressRecipient) + CustomerTaxId (D53), PaymentDetails, Items (Description folded to one line, Quantity, UnitPrice, Amount, Tax, TaxRate → `taxRate` %); the currency from the amounts |
| contract | prebuilt-layout | Raw text only |
| nda | prebuilt-layout | Raw text only |
| certificate | prebuilt-layout | Raw text only |

Unknown/custom prefix types (from tenant configuration in Story 3.4) fall back to `prebuilt-layout` with a warning log.

**The currency** (2026-10-24): Azure DI has no document-level currency field — each amount carries its own `valueCurrency.currencyCode`. `extractCurrencyCode` takes the first ISO code among the totals, then the lines; none → unknown (never SEK, F61-b). **Reverse charge** (D54): `mentionsReverseCharge(content)` on the document's text (en / fr / sv / de / it / es) sets `reverseCharge` — a flag, no VAT computed. The mapping is the pure `mapAnalyzeResult`, tested on stored responses of the real shape with invented values (`__fixtures__/azure-*.json`, `ocr-mapping.pure.test.ts`).

## Dual Source Approach

| Blob Location | OCR Endpoint | Strategy | Rationale |
|--------------|-------------|----------|-----------|
| Azure cloud | Azure cloud | SAS URL (`urlSource`) | Zero memory, Azure-to-Azure network |
| Azurite local | Azure cloud | Buffer (`base64Source`) | Azure DI can't reach localhost |
| Azurite local | Mock | Buffer (N/A) | Mock ignores source |

Detection: `isReachableAzureBlob(blobUrl)` (`documents/jobs/process-document.ts`) — only an `https://*.blob.core.windows.net` URL goes to Azure DI as a SAS link; everything else (Azurite on `127.0.0.1` locally, `http://azurite:10000` inside the prod compose) is sent as bytes. `OCR_PROVIDER` picks the service (`azure` with both keys, `mock` by name, otherwise a service that fails every call with the configuration error — F108).

## Quality Classification

Stored in `ocrData.quality` as metadata for Story 5.3 UI treatment:

| Quality | Criteria | Story 5.3 UI Treatment |
|---------|----------|----------------------|
| `high` | confidence >= 0.7 AND key financial field extracted | "Review extracted data" |
| `low` | confidence < 0.7 OR missing key fields | "Low confidence — manual review" |
| `none` | Layout model OR zero documents in response | "Manual entry required" |

## Status Lifecycle with OCR

```
uploaded → processing → extracted → linked
                     ↘ ocr_failed
```

- `uploaded` → `processing`: the job's claim (first attempt)
- `processing` → `extracted`: on OCR success
- `processing` → `ocr_failed`: on a non-retryable failure, or by the dead-letter handler after the last retry

## The job (resumable, three short phases)

```
enqueue(processDocumentJob, { tenantId, userId, documentId }, { singletonKey: documentId })   from onCommit of the upload
  1. claim      uploaded → processing              short RLS transaction; any other status = already claimed, carry on
  2. OCR        read doc, prepare source, call DI   the call runs OUTSIDE any transaction (10–15 s)
  3. save       processing → extracted | ocr_failed short RLS transaction
  4. after      extracted → the `setOnDocumentExtracted` hook (F126: linking queues the model's BAS proposal;
                wired in instrumentation.ts, a failure only logged — never the document's)
  onDeadLetter  processing → ocr_failed            after OCR_MAX_RETRIES or an expired attempt; idempotent
```

A retry re-runs the whole handler: phase 1 sees `processing` and skips, phase 2 runs OCR again, phase 3 saves. Nothing is memoised — a crash between OCR and save costs one more Azure DI call, and in exchange every attempt is safe from any state (constitution §1.9). The queue is `exclusive` on `documentId`: one job per document queued or active.

## Retry and failure handling

- Retries: `OCR_MAX_RETRIES` with exponential backoff from 30 s; an attempt expires after 5 min
- Retryable errors (the handler throws): timeout, 5xx, 429 rate limit, blob download failure
- Non-retryable (the handler writes `ocr_failed` and returns): 401/403 auth failure, unsupported file
- Document not found (rolled-back upload, deleted since): the handler logs and returns — nothing to resume
- Dead letter: `documents.process-document.dead` → `onDeadLetter` marks the document `ocr_failed` if it is still `processing`

## ocrData JSONB Structure

```typescript
{
  extractedData: OcrExtractedData,   // Structured fields for Story 5.3 review form
  rawResponse: AnalyzeResult,        // Full Azure DI response (Bokföringslagen provenance)
  quality: "high" | "low" | "none",  // Classification for UI treatment
}
```

Read back by `parseOcrPayload()` in `src/modules/documents/ocr-payload.ts` — the one place that turns the column into `{ extractedData, quality }` (null when the OCR has not run); `getDocumentOcrData()` (`review.ts`), the review page, the library and the inbox all go through it. `rawResponse` is never read by the app.

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `OCR_PROVIDER` | No | `azure` (default) or `mock`. **The mock runs only when named** (F108, audit 2026-10-27 B3): it invents readings ("Test Vendor AB · 1 250.00 · INV-2026-001", quality *high*) that the inbox, the scorer and *Make it…* would treat as read facts |
| `AZURE_DI_ENDPOINT` | With `azure` | Missing → `resolveOcrProvider` returns `none` and every OCR job fails **non-retryable** with the reason (`OCR is not configured (AZURE_DI_KEY not set) — set …`): the document lands on *OCR failed*, the reason is in the audit log and in the app log at `error` |
| `AZURE_DI_KEY` | With `azure` | Same |

`.env.example` sets `OCR_PROVIDER=mock` (dev); the CI e2e job and the Playwright dev server set it too (their upload flows wait for the mock's readings). **CI MUST NOT set `AZURE_DI_ENDPOINT`** — prevents accidental real API calls and costs. Production sets the two keys and nothing else: a typo there is visible on the first upload, not after a month of invented vendors.

## Security

- **NEVER log ocrData contents** — they contain IBANs, tax IDs, invoice amounts
- Only log: documentId, modelUsed, confidence, durationMs, quality, success
- SAS URL lifetime: 5 minutes (Azure DI typically processes in 2-15 seconds)

## Testing

- Mock service tests: prefix-specific fixtures, quality classification, model selection
- Job tests (`jobs/process-document.test.ts`): handler and dead-letter handler called directly — happy path, resume from `processing`, status guards, retryable vs non-retryable errors, audit logging
- Integration tests (gated): `describe.skipIf(!process.env.AZURE_DI_ENDPOINT)` for real Azure DI
- Test fixtures: `src/kernel/ocr/__fixtures__/test-invoice.pdf`, `test-receipt.jpg`

## Known limitation

A job that expires (worker killed mid-OCR) is retried, then dead-lettered — so a document cannot stay in `processing` unless the dead-letter handler itself keeps failing (its queue retries twice). Recovery then: `select id, name, state, output from pgboss.job where name like 'documents.%' and state = 'failed'`, fix the cause, and `UPDATE documents SET status = 'ocr_failed' WHERE status = 'processing' AND updated_at < now() - interval '1 hour'`.
