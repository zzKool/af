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

- `uploaded` → `processing`: the job's claim (first attempt)
- `processing` → `extracted`: on OCR success
- `processing` → `ocr_failed`: on a non-retryable failure, or by the dead-letter handler after the last retry

## The job (resumable, three short phases)

```
enqueue(processDocumentJob, { tenantId, userId, documentId }, { singletonKey: documentId })   from onCommit of the upload
  1. claim      uploaded → processing              short RLS transaction; any other status = already claimed, carry on
  2. OCR        read doc, prepare source, call DI   the call runs OUTSIDE any transaction (10–15 s)
  3. save       processing → extracted | ocr_failed short RLS transaction
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
- Job tests (`jobs/process-document.test.ts`): handler and dead-letter handler called directly — happy path, resume from `processing`, status guards, retryable vs non-retryable errors, audit logging
- Integration tests (gated): `describe.skipIf(!process.env.AZURE_DI_ENDPOINT)` for real Azure DI
- Test fixtures: `src/kernel/ocr/__fixtures__/test-invoice.pdf`, `test-receipt.jpg`

## Known limitation

A job that expires (worker killed mid-OCR) is retried, then dead-lettered — so a document cannot stay in `processing` unless the dead-letter handler itself keeps failing (its queue retries twice). Recovery then: `select id, name, state, output from pgboss.job where name like 'documents.%' and state = 'failed'`, fix the cause, and `UPDATE documents SET status = 'ocr_failed' WHERE status = 'processing' AND updated_at < now() - interval '1 hour'`.
