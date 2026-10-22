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

### Mark as Reviewed button

Reviewed = **filed** (specs/documents, assumption confirmed 2026-10-21): a reviewed document that became nothing leaves the inbox. Three states: not yet reviewed (solid green-700 with white text — green-600 fails WCAG AA contrast, which the review page's axe check enforces), corrections pending (amber outline), reviewed (muted green outline).

## E2E

`e2e/document-review.spec.ts` — every owner journey uploads its own PDF through the library and opens that row, so a parallel journey deleting its upload, or an issued invoice's generated PDF landing first in the list, cannot change what the test sees (the suite runs with 2 workers in CI). The accountant journey only needs the list.

## Make it… (specs/documents US1 — 2026-10-21)

Under the review form, for the owner, on a document that is not generated and has not become anything: **Expense**, **Supplier invoice**, **Just file it**. The two buttons open the modules' own dialogs (`NewExpenseDialog`, `NewSupplierInvoiceDialog` through their `ui` surfaces) with `initial` built by `initialFromFacts` from the OCR facts **as corrected** (date, amounts, currency, VAT, number, vendor / merchant) and the document pre-selected; creating writes the `created_from` link (D27) in the module's service as before. *Just file it* = `markDocumentReviewedAction` — nothing created, the document leaves the inbox (a bank statement, a contract). Once a `created_from` link exists the page shows *Became expense Ex213-Tr-04* (the section and a chip in the header, both linking to the entity) and no buttons. The page (`/documents/[id]`) composes it: `linksWithLabels(tx, { type: "document", id })` for *became*, `expensePageOptions` + `supplierInvoicePageOptions` for the dialogs' option lists (null for the accountant and for generated PDFs).

A relationship document (contract, NDA) becomes nothing: only *Just file it* is offered (the same on the inbox, [[document-inbox]]).

The supplier dialog first shows the **supplier match** ([[partners]] `matchPartners`): the best partner from 60 % with *Use match*, the other matches, *New vendor* (name + VAT pre-filled, `createPartnerAction`, selected at once). Both dialogs run the **entity duplicate check** when the key fields settle (400 ms): a *high* match blocks until a note says why it is not one (*Create anyway*, `duplicateAck` → the note on the entity, the acknowledgement in the audit row); a *medium* match warns inline. Rules in [[expenses]] and [[supplier-invoices]].

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

- `src/modules/documents/review.ts` — service methods (getDocumentForReview, updateDocumentCorrections, classifyDocument, markDocumentReviewed, refreshSignedUrl); `ocr-payload.ts` — `parseOcrPayload` (the `ocr_data` reader) and `resolveDocumentData` (corrections over the OCR facts)
- `src/modules/documents/documents.actions.ts` — server action wrappers
- `src/app/(app)/documents/[id]/page.tsx` — server component entry
- `src/modules/documents/components/document-review-client.tsx` — main orchestrator
- `src/modules/documents/components/document-preview.tsx` — PDF/image viewer
- `src/modules/documents/stores/use-document-review-store.ts` — Zustand corrections store

## Related

- [[document-upload]] — Upload pipeline and status lifecycle
- [[document-library]] — Document library, paginated list, download
- [[ocr-processing]] — OCR extraction and quality classification
- [[auto-save-pattern]] — General auto-save form pattern reference
- [[zustand-stores]] — Tenant-scoped store pattern
