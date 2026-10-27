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

### The corrections schema (F61)

`ocr-payload.ts` holds one zod schema per field — `vendorName`, `vendorTaxId`, `merchantName`, `invoiceNumber` (text ≤ 500), `invoiceDate`, `transactionDate`, `dueDate` (ISO day or `""` = cleared), `currency` (one of `CURRENCIES`), `invoiceTotal`, `subtotal`, `totalTax` (finite numbers), `items` (line items, ≤ 500). Used twice:

```
write  correctionsPatchSchema (strict) ── action + updateDocumentCorrections ── a bad patch → VALIDATION_ERROR, nothing stored
read   parseCorrections (per field)    ── library, inbox, review, linkable ── a stored value that does not fit is dropped → the OCR value shows
```

So `{invoiceTotal: null}` (an emptied number field used to send it) is refused on save, and an old row holding it still lists. Amounts reach the lists through `amountText` (finite number → 2 decimals, else null). The matcher gets a currency only when it is a code the app knows (`knownCurrency`); OCR's `prebuilt-receipt` reads none, so **set the currency on review** — a receipt corrected to CHF is compared as CHF. An uncorrected receipt is *unknown* to the matcher (F61-b): matched on reference, name and date only, linked without an allocation.

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

Under the review form, for the owner, on a document that is not generated, not archived and has not become anything: **Expense**, **Supplier invoice**, **Just file it**. The two buttons open the modules' own dialogs (`NewExpenseDialog`, `NewSupplierInvoiceDialog` through their `ui` surfaces) with `initial` built by `initialFromFacts` from the OCR facts **as corrected** (date, amounts, currency, VAT, number, vendor / merchant, the vendor address — `vendorAddress`, T028) and the document pre-selected; creating writes the `created_from` link (D27) in the module's service as before. *Just file it* = `markDocumentReviewedAction` — nothing created, the document leaves the inbox (a bank statement, a contract). Once a `created_from` link exists the page shows *Became expense Ex213-Tr-04* (the section and a chip in the header, both linking to the entity) and no buttons. An **archived** document (parked from the inbox) shows *Archived {date}* in that place instead, with *Restore* for the owner (`unarchiveDocumentsAction` on that one id, then a refresh — the document is back in the inbox and *Make it…* comes back); the accountant sees the line without the button. Archive refuses a document that became something, so the two never meet. The page (`/documents/[id]`) composes it: `linksWithLabels(tx, { type: "document", id })` for *became*, `expensePageOptions` + `supplierInvoicePageOptions` for the dialogs' option lists (null for the accountant and for generated PDFs).

A relationship document (contract, NDA) becomes nothing: only *Just file it* is offered (the same on the inbox, [[document-inbox]]).

The supplier dialog first shows the **supplier match** ([[partners]] `matchPartners`): the best partner from 60 % with *Use match*, the other matches, *New vendor* (name, VAT and the OCR vendor address pre-filled — the address also scores the match, +20, `createPartnerAction`, selected at once). Both dialogs run the **entity duplicate check** when the key fields settle (400 ms): a *high* match blocks until a note says why it is not one (*Create anyway*, `duplicateAck` → the note on the entity, the acknowledgement in the audit row); a *medium* match warns inline. Rules in [[expenses]] and [[supplier-invoices]].

## What the reading fills (2026-10-24)

- Vendor / merchant, dates, invoice #, **vendor VAT number**, totals, VAT, **currency** (from Azure's amounts — it was never read before), line items with **Tax %**.
- **Billed to** (invoices, D53): name and VAT number as printed, editable; a warning *Not addressed to {company}* when neither the name nor the VAT number fits the company profile and its VAT registrations (`billed-to.ts`, `checkBilledTo`). Never blocks.
- **Reverse charge** (D54): ticked when the text says so, the owner can set or clear it; a tag on the title row. Nothing is computed — the VAT treatment stays the accountant's.
- **Mark as Reviewed (n corrections made)** counts the fields that differ from the OCR's reading (`corrections-count.ts`), not the fields read.
- Screenshots: `specs/documents/screenshots/review-billed-to-reverse-charge.png`, `review-billed-to-mismatch.png` (seed data).

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

## Re-run OCR (FR-021)

On an **extracted** document the owner has *Re-run OCR* in the header. It asks first ("your corrections stay; the extracted facts are replaced"), then calls `runOcrAction({ documentId, force: true })`: the document goes back to *uploaded*, the job is queued after the commit (one per document, `singletonKey`), the page refreshes. `corrections` is never touched, so every field fixed by hand keeps its value over the new reading. A pending, stuck or failed document is re-run from the inbox (*Run OCR*, `o`), which refuses an extracted one and points here. The accountant never sees the button.

## Title row (D40, F71)

`PageHeader`: the key in mono with the document's derived state (`<DocumentStateLabel>`, the module's one family map — the inbox's word: *Ready* until decided, *Filed* once it became something or was filed, *Archived*, *generated*…) · tags: the kind, and the OCR quality from Story 5.2 for the owner (*Review extracted data* / *Low Confidence — Manual Review Recommended* / *Manual Entry Required* — metadata about the extraction, grey, never a colour) · *Became expense {key}* as a link · meta: file, size, uploaded, reviewed / awaiting review · the one action *Re-run OCR*. No back link of its own: the shell's breadcrumb (*Documents ›*) is the way back. *Mark as Reviewed* / *Update Review* is the form's primary; once reviewed it is a secondary *Reviewed* (no green, no amber). The line-items mismatch is a grey banner with the attention icon, its totals through `formatMoney`.

## Document Classification

Owners can reclassify documents by changing the category (financial/relationship) and sub-type (expense, invoice, contract, nda, certificate). This updates `documentType` and `prefixType`.

**The type drives the reading (D52).** Before the owner reviewed the document (and while it became nothing — see below), a type change also
- swaps the provisional key's prefix, same date and number: `exp_20261024_002` ↔ `inv_20261024_002` (`numbering.reprefixUploadKey`; a final key or a generated document's never changes — a generated document cannot be reclassified at all);
- reads the document again when the new kind has another model (`ocrModelFor`: receipt ↔ invoice ↔ layout; contract → NDA is the same layout, no new reading): an *extracted* or *OCR failed* document goes back to *uploaded* and the action queues the job after the commit, exactly like *Re-run OCR* — `corrections` stays. A document still *uploaded* is not re-queued (the job reads the new type when it runs); one *processing* is left to finish, the owner re-runs it after.

`classifyDocument` returns `{ documentType, prefixType, businessKey, reread }`; the page toasts *Invoice — the OCR reads the document again* and refreshes. While the document is *uploaded* / *processing* the review page refreshes itself every 3 s (three minutes at most — past that the inbox's *stuck* takes over), and the form remounts on a new reading (its fields are uncontrolled), so the new facts appear without a reload. After the review a type change is a label only: the owner checked the facts, the key and the reading stay.

A **linked** document cannot be reclassified: something became from it (`created_from`) or a bank row justifies it (`justifies`). Linked is derived from the links (`linkable.ts` — `linkedIds` / `isDocumentLinked`, through `linking.linksTouching`), never from the stored status; `"linked"` is not a status value. Deleting a document asks `linking.isLinked` (any link — the database trigger's own test) before writing anything, so the *blocked* audit row survives.

## Document Preview

- **PDF**: react-pdf v10 with local worker (`public/pdf.worker.min.mjs`), per-page rendering
- **Images**: native `<img>` with CSS transform for zoom/rotation
- **Controls**: zoom in/out/fit, rotation (90-degree increments), page navigation (PDF)
- **The bytes** (F106, D61 — audit 2026-10-27 D2): the preview and *Download* read `GET /api/documents/[id]/file` (`?download=1` for an attachment) — the session's caller → `documents.documentFile` (RLS + the accountant's financial-only rule, in one place) → the storage adapter streams the blob. The browser never sees a storage URL: no SAS, no CORS, no `blob-proxy` (deleted — it fetched any `localhost` URL unauthenticated), nothing to refresh. `documentFileUrl(id)` is the pure helper the review DTO (`fileUrl`), the inbox pane and `getDocumentDownloadUrl` share. The e2e uploads a real one-page PDF (`e2e/fixtures/pdf.ts`) and asserts the viewer rendered a canvas, the route's headers, and 401 without a session.

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

- `src/modules/documents/review.ts` — service methods (getDocumentForReview, updateDocumentCorrections, classifyDocument, markDocumentReviewed); `file.ts` — `documentFile` / `documentFileUrl` / `contentDisposition` behind `/api/documents/[id]/file` (F106); `ocr-payload.ts` — `parseOcrPayload` (the `ocr_data` reader) and `resolveDocumentData` (corrections over the OCR facts)
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
