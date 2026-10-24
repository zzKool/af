# Document Upload Flow

## Overview

Documents are uploaded via `FileUploadZone` component on the `/documents` page (owner-only). The upload pipeline validates files, stores blobs in Azure, generates business keys, and enqueues the OCR job after commit.

## Upload Pipeline

```
User drops file → FileUploadZone (client component)
  → Selects the document kind (expense/invoice/contract/nda/certificate — fixed list)
  → Client-side pre-validation (size + extension)
  → uploadDocumentAction (server action)
    → auth + tenant + audit middleware
    → Convert File to Buffer
    → documents.uploadDocument(tx, caller, audit, storage, clock, buffer, fileName, prefixType)
      → fileValidation.validateFile(buffer, fileName) → magic bytes check → verified MIME
      → storage.ensureContainer() (memoized)
      → storage.uploadBlob(tenantId/uuid.ext, buffer, verifiedMime, { contentDisposition: 'attachment' })
      → businessKey.generateBusinessKey(tx, caller, kind, clock)   → numbering.nextInSeries('doc-yyyy-mm')
      → tx.document.create({ status: 'uploaded', ... })
      → audit.log({ action: 'create', entityType: 'document' })
    → onCommit: enqueue(processDocumentJob, { tenantId, userId, documentId }, { singletonKey: documentId })
  → Client shows business key + "Upload another"
```

## File Validation

- Uses `file-type` package for magic byte detection — never trusts browser `File.type`
- Allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/tiff`
- Max size: 10 MB
- File names sanitized: path separators stripped, truncated to 255 chars
- Detected MIME/extension used for blob path and DB record

## Business Key Generation

Provisional key of a raw upload, a fixed function (D6, see [[numbering]]): `uploadDocumentKey(kind, date, seq)` → `{prefix}{YYYYMMDD}_{NNN}`

- Prefix per kind is a constant: `exp_`, `inv_`, `ctrt_`, `nda_`, `cert_` (`UPLOAD_KIND_PREFIX`) — no settings
- Date uses Stockholm timezone via the Clock abstraction
- `NNN` = `nextInSeries(tx, caller, "doc-yyyy-mm")`: gap-free per tenant per month, row-locked in the upload transaction
- The document gets its final key when it becomes something: expense receipt `Ex213-Tr-01_2026-03-11_`, issued invoice `InvoiceAF_VA26-INV-001.pdf`
- Until then the provisional key **follows the type** (D52): a type change on the review page before the review swaps the prefix, same date and number — `reprefixUploadKey("exp_20261024_002", "invoice")` → `inv_20261024_002` (the series is shared by every kind, so the key stays unique). See [[document-review]].

**No default type (D52).** The upload's *Document type* starts on *Choose the type…*: the type picks the OCR model and the key's prefix, so a click on the zone or a dropped file without one posts nothing — a toast says to choose it and the selector gets the focus. The options read *Expense (exp_)*, *Invoice (inv_)*… The choice stays for *Upload another*.

## Document Classification

| Prefix Type | Classification |
|-------------|---------------|
| expense | financial |
| invoice | financial |
| contract | relationship |
| nda | relationship |
| certificate | relationship |

Classification is derived automatically from the kind — users never see it in UI.

## Status Lifecycle

```
uploaded → processing → extracted → linked
                     ↘ ocr_failed
```

- `uploaded`: Initial state after successful upload
- `processing`: the `documents.process-document` job claimed it (see [[async-jobs]])
- `extracted`: OCR completed successfully — `ocrData` JSONB populated with extracted fields, raw response, and quality indicator (Story 5.2)
- `ocr_failed`: OCR processing failed after 3 retries or non-retryable error (Story 5.2). User sees "OCR unavailable — manual entry required"
- `linked`: Document linked to a transaction (Story 7.1)

See [[ocr-processing]] for OCR service details, the resumable job, and quality classification.

## The same file twice (specs/documents US2, D32 — 2026-10-21)

Every stored document carries `content_hash` (sha256 hex of the bytes; uploads and generated PDFs alike; index `(tenant_id, content_hash)`, not unique). `uploadDocument` computes it after the file validation and looks it up **before** writing anything: a hit returns `{ kind: "duplicate", existing }` — the existing document's key, file name, date, uploader and what it became (`linking.createdFromTargets` with the entity's key: *became expense Ex213-Tr-04*). The uploader's **name** is resolved by `uploadDocumentAction` through `uploaderName(prisma, createdBy)` (kernel/auth's `userName`, F66) — `users` belongs to auth, not to a tenant, so it is read with the plain client, not the tenant transaction; a user that is gone leaves *Uploaded {date}* alone — and the upload zone shows the amber card: *Use existing document* (the review page), *Upload anyway* (the owner; `force=true` stores a second copy, audited `knowingDuplicateOf`), *Upload another*. A hard-deleted document never matches. Rows stored before the column have a null hash until `scripts/backfill-document-hashes.ts` reads their blobs once. `sameContentDocumentIds(tx, id)` is what the entity duplicate check ([[expenses]], [[supplier-invoices]]) reads.

## Azure Blob Storage

- Blob path: `/{tenantId}/{uuid}.{detectedExt}`
- Content-Disposition: `attachment` (XSS prevention — forces download, prevents inline rendering)
- Container ensured once per process (memoized)
- Orphan blobs logged as warnings if DB write fails after upload
- Generated documents (`storeGeneratedDocument`: a rendered PDF, an imported bank statement CSV, the accountant package's zip) share the path convention; `documentsByIds` and `documentReaders` (readers to call outside a transaction) are how another module copies documents without seeing a blob path ([[accountant-package]])

## Role Access

| Action | Owner | Accountant |
|--------|-------|------------|
| Upload | Yes | No (FORBIDDEN) |
| View page | Yes | No (redirected to dashboard) |

Accountant gets read-only access to financial documents in the review workflow.

## Next: Review Workflow

After OCR extraction, documents are available for review at `/documents/[id]`. See [[document-review]] for the corrections overlay pattern, role-based access, and dual-pane review UI.
