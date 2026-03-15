# Document Upload Flow

## Overview

Documents are uploaded via `FileUploadZone` component on the `/documents` page (owner-only). The upload pipeline validates files, stores blobs in Azure, generates business keys, and dispatches async Inngest events.

## Upload Pipeline

```
User drops file → FileUploadZone (client component)
  → Selects prefix type (expense/invoice/contract/...)
  → Client-side pre-validation (size + extension)
  → uploadDocumentAction (server action)
    → auth + tenant + audit middleware
    → Convert File to Buffer
    → documents.uploadDocument(tx, caller, audit, storage, clock, buffer, fileName, prefixType)
      → fileValidation.validateFile(buffer, fileName) → magic bytes check → verified MIME
      → storage.ensureContainer() (memoized)
      → storage.uploadBlob(tenantId/uuid.ext, buffer, verifiedMime, { contentDisposition: 'attachment' })
      → businessKey.generateBusinessKey(tx, caller, audit, prefixType, clock)
      → tx.document.create({ status: 'uploaded', ... })
      → audit.log({ action: 'create', entityType: 'document' })
    → inngest.send('document/uploaded', { tenantId, userId, documentId })
  → Client shows business key + "Upload another"
```

## File Validation

- Uses `file-type` package for magic byte detection — never trusts browser `File.type`
- Allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/tiff`
- Max size: 10 MB
- File names sanitized: path separators stripped, truncated to 255 chars
- Detected MIME/extension used for blob path and DB record

## Business Key Generation

Format: `{prefix}{YYYYMMDD}_{NNN}`

- Prefix comes from tenant's `DocumentTypePrefix` config (e.g., `exp_`, `inv_`)
- Date uses Stockholm timezone via Clock abstraction
- Sequence number (`NNN`) is atomic per tenant per month via `document_key_counters` table
- Counter uses `INSERT ... ON CONFLICT DO UPDATE SET next_val = next_val + 1 RETURNING next_val`

## Document Classification

| Prefix Type | Classification |
|-------------|---------------|
| expense | financial |
| invoice | financial |
| contract | relationship |
| nda | relationship |
| certificate | relationship |

Classification is derived automatically from prefix type — users never see it in UI.

## Status Lifecycle

```
uploaded → processing → extracted → linked
                     ↘ ocr_failed
```

- `uploaded`: Initial state after successful upload
- `processing`: Inngest function picks up the event (Story 5.1 sets this)
- `extracted`: OCR completed successfully — `ocrData` JSONB populated with extracted fields, raw response, and quality indicator (Story 5.2)
- `ocr_failed`: OCR processing failed after 3 retries or non-retryable error (Story 5.2). User sees "OCR unavailable — manual entry required"
- `linked`: Document linked to a transaction (Story 7.1)

See [[ocr-processing]] for OCR service details, 3-step Inngest architecture, and quality classification.

## Azure Blob Storage

- Blob path: `/{tenantId}/{uuid}.{detectedExt}`
- Content-Disposition: `attachment` (XSS prevention — forces download, prevents inline rendering)
- Container ensured once per process (memoized)
- Orphan blobs logged as warnings if DB write fails after upload

## Role Access

| Action | Owner | Accountant |
|--------|-------|------------|
| Upload | Yes | No (FORBIDDEN) |
| View page | Yes | No (redirected to dashboard) |

Accountant gets read-only access to financial documents in the review workflow.

## Next: Review Workflow

After OCR extraction, documents are available for review at `/documents/[id]`. See [[document-review]] for the corrections overlay pattern, role-based access, and dual-pane review UI.
