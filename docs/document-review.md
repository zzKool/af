# Document Review & Correction

## Overview

After OCR extraction (Story 5.2), documents enter the review workflow. Owners can review extracted data, correct errors, reclassify documents, and mark them as reviewed. Accountants get financial document read-only access.

Route: `/documents/[id]` — dual-pane layout with document preview (left) and editable data form (right).

## Corrections Overlay Pattern

User corrections are stored in a separate `corrections` JSONB column, preserving the original `ocrData` (provenance). The final truth is computed by merging:

```typescript
resolveDocumentData(extractedData, corrections)
// → { ...extractedData, ...corrections } (shallow merge, arrays fully replaced)
```

This utility is exported for reuse in Epic 7 match scoring.

### Why not mutate extractedData?

- **Audit trail**: original OCR output always available for comparison
- **Rollback**: corrections can be cleared without re-running OCR
- **Transparency**: UI shows OcrHint when a field has been corrected (original value visible)

## Atomic JSONB Merge

Corrections use raw SQL for concurrent safety:

```sql
UPDATE documents
SET corrections = COALESCE(corrections, '{}'::jsonb) || $patch::jsonb,
    updated_at = NOW()
WHERE id = $documentId::uuid
  AND tenant_id = current_setting('app.tenant_id')::uuid
RETURNING corrections
```

This bypasses Prisma's read-then-write pattern, preventing lost-update race conditions. The `tenant_id` check is a safety net since `$queryRaw` bypasses RLS middleware.

## Review Workflow

1. **Auto-save**: field corrections save on blur (text) or change (selects). Line items save full array on section blur.
2. **Explicit review**: "Mark as Reviewed" button sets `reviewedAt` + `reviewedBy`. Idempotent — re-review updates the timestamp.
3. **Review state** is orthogonal to document status — tracked via `reviewedAt`/`reviewedBy`, not a new status value.

### Save Status Indicators

- Idle (no indicator)
- Saving (spinner)
- Saved (checkmark, auto-fades)
- Error (red, with retry guidance)

## Role-Based Access

| Action | Owner | Accountant |
|--------|-------|------------|
| View financial documents | Full edit | Read-only |
| View relationship documents | Full edit | Blocked (FORBIDDEN) |
| Save corrections | Yes | No |
| Reclassify document | Yes | No |
| Mark as reviewed | Yes | No |

Access enforced in both `getDocumentForReview` service (server) and UI (readOnly prop).

## Quality Indicator

OCR quality classification from Story 5.2 is displayed in the header:

| Quality | Badge | Color |
|---------|-------|-------|
| high | High confidence | Green |
| low | Low confidence | Yellow |
| null/missing | No OCR data | Gray |

## Document Classification

Owners can reclassify documents by changing the category (financial/relationship) and sub-type (expense, invoice, contract, nda, certificate). This updates `documentType` and `prefixType` but **never changes the business key** (immutable after generation).

Linked documents cannot be reclassified.

## Document Preview

- **PDF**: react-pdf v10 with local worker (`public/pdf.worker.min.mjs`), per-page rendering
- **Images**: native `<img>` with CSS transform for zoom/rotation
- **Controls**: zoom in/out/fit, rotation (90-degree increments), page navigation (PDF)
- **Signed URL refresh**: auto-refreshes at 80% TTL (4 minutes) via `SIGNED_URL_REFRESH_MS`

## Line Items Editing

- Editable table: description, quantity, unit price, amount, tax
- Amount auto-calculated from quantity * unit price
- Add/delete rows with 3-second undo toast
- Total mismatch warning when line items sum differs from header total
- Full array saved on section blur (not per-field)

## Type-Aware Form Sections

| Document Type | Sections Shown |
|---------------|---------------|
| expense/invoice | Financial fields, line items, payment details |
| contract/nda/certificate | Relationship fields (read-only raw text) |

## Key Files

- `src/server/services/documents.ts` — service methods (getDocumentForReview, updateDocumentCorrections, classifyDocument, markDocumentReviewed, refreshSignedUrl)
- `src/server/actions/documents.ts` — server action wrappers
- `src/app/(app)/documents/[id]/page.tsx` — server component entry
- `src/components/domain/document-review-client.tsx` — main orchestrator
- `src/components/domain/document-preview.tsx` — PDF/image viewer
- `src/hooks/use-document-review-store.ts` — Zustand corrections store

## Related

- [[document-upload-flow]] — Upload pipeline and status lifecycle
- [[ocr-processing]] — OCR extraction and quality classification
- [[auto-save-pattern]] — General auto-save form pattern reference
- [[zustand-stores]] — Tenant-scoped store pattern
