# OCR Processing

## Overview

Documents uploaded via Story 5.1 are automatically processed by Azure Document Intelligence (or a mock service) to extract financial fields. The OCR pipeline runs as an [[async-jobs|Inngest function]] with a 3-step architecture for cost optimization and retry resilience.

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

Prefix types map to Azure DI prebuilt models via a configurable map:

| Prefix Type | Model | Fields Extracted |
|-------------|-------|-----------------|
| expense | prebuilt-receipt | MerchantName, Total, TransactionDate, Items |
| invoice | prebuilt-invoice | VendorName, InvoiceTotal, InvoiceDate, PaymentDetails, Items |
| contract | prebuilt-layout | Raw text only |
| nda | prebuilt-layout | Raw text only |
| certificate | prebuilt-layout | Raw text only |

Unknown/custom prefix types (from tenant configuration in Story 3.4) fall back to `prebuilt-layout` with a warning log.

## Dual Source Approach

| Blob Location | OCR Endpoint | Strategy | Rationale |
|--------------|-------------|----------|-----------|
| Azure cloud | Azure cloud | SAS URL (`urlSource`) | Zero memory, Azure-to-Azure network |
| Azurite local | Azure cloud | Buffer (`base64Source`) | Azure DI can't reach localhost |
| Azurite local | Mock | Buffer (N/A) | Mock ignores source |

Detection: `blobUrl.includes("127.0.0.1")` → local blob. `AZURE_DI_ENDPOINT?.includes("azure")` → remote OCR.

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

- `uploaded` → `processing`: Step 1 of Inngest function
- `processing` → `extracted`: Step 3 on OCR success
- `processing` → `ocr_failed`: Step 3 on non-retryable failure, or `onFailure` after retry exhaustion

## 3-Step Inngest Architecture

```
document/uploaded event
  → step.run("update-status-to-processing")   [memoized]
  → step.run("run-ocr-analysis")              [expensive, memoized]
  → step.run("save-ocr-result")               [cheap DB write]
  → onFailure handler                         [safety net]
```

**Why 3 steps:** If `save-ocr-result` fails (DB timeout), Inngest retries only that step. The expensive Azure DI API call in `run-ocr-analysis` is memoized and not re-executed, saving cost.

## Retry and Failure Handling

- Retries: 3 (Inngest default exponential backoff)
- Retryable errors: timeout, 5xx, 429 rate limit, blob download failure
- Non-retryable: 401/403 auth failure, document not found
- `onFailure` handler: marks document as `ocr_failed` if all retries exhausted
- `onFailure` is idempotent — skips if document is already `ocr_failed` or `extracted`

**CRITICAL:** `onFailure` receives a wrapped event at `event.data.event.data`, not `event.data`.

## ocrData JSONB Structure

```typescript
{
  extractedData: OcrExtractedData,   // Structured fields for Story 5.3 review form
  rawResponse: AnalyzeResult,        // Full Azure DI response (Bokföringslagen provenance)
  quality: "high" | "low" | "none",  // Classification for UI treatment
}
```

Accessed via `getDocumentOcrData()` in `src/modules/documents/documents.ts`.

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `AZURE_DI_ENDPOINT` | No | If not set, mock OCR service used |
| `AZURE_DI_KEY` | No | Required with endpoint |

**CI MUST NOT set `AZURE_DI_ENDPOINT`** — prevents accidental real API calls and costs.

## Security

- **NEVER log ocrData contents** — they contain IBANs, tax IDs, invoice amounts
- Only log: documentId, modelUsed, confidence, durationMs, quality, success
- SAS URL lifetime: 5 minutes (Azure DI typically processes in 2-15 seconds)

## Testing

- Mock service tests: prefix-specific fixtures, quality classification, model selection
- Inngest function tests: 3-step flow, error handling, onFailure handler, audit logging
- Integration tests (gated): `describe.skipIf(!process.env.AZURE_DI_ENDPOINT)` for real Azure DI
- Test fixtures: `src/kernel/ocr/__fixtures__/test-invoice.pdf`, `test-receipt.jpg`

## Known Limitation

If Inngest infrastructure fails mid-processing and never fires `onFailure`, documents remain in `processing` forever. Recovery: find documents with `status = "processing"` older than 10 minutes in Prisma Studio, update to `ocr_failed`.
