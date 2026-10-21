# Implementation Plan: Document inbox — what a document becomes, duplicates, the work queue

**Branch**: `feat/documents-become` (part 1: content hash + upload duplicate, *Make it…* on the review page with the supplier match and the entity duplicate check, filed = reviewed) · `feat/documents-inbox` (part 2: archive + undo, OCR re-run, the inbox work page, the keyboard, the dashboard item) | **Date**: 2026-10-21 | **Spec**: `specs/documents/spec.md`

## Summary

Nothing new is owned: expenses and supplier invoices already create from a `documentId` and write the `created_from` link (D27); the linking module already scores bank rows for a document and applies the link; the partners module already creates vendors; the OCR job already runs per document. This feature adds **two columns** on `documents` (`content_hash`, `archived_at/by`), **three read models** (inbox rows + counts, duplicate-of, duplicate matches), **two pre-fill paths** into the existing dialogs, **one match** (OCR vendor → partner) and **one work page** shaped like `/banking/inbox`. Statuses stay the pipeline's; *filed*, *became*, *archived* are facts beside them.

```
review page ──► MakeItSection (documents) ──► NewExpenseDialog / NewSupplierInvoiceDialog (initial = OCR facts, documentId)
                                                  │ on open + key fields: checkDuplicates…Action → block (note) / warn
                                                  └ supplier: matchPartnersAction → Use match / New vendor (createPartnerAction)
upload ──► uploadDocument: sha256 → same hash? → { duplicate: existing } ──► card: Use existing / Upload anyway (force)
/documents/inbox ──► listInbox + inboxCounts (documents/queries) ──► InboxWorkbench (documents/components) ──► archive / unarchive / runOcr actions, undo stack
```

## Technical Context

Prisma 7 / Zod 4 / next-safe-action / pg-boss — no new packages. `node:crypto` sha256. One migration (`documents.content_hash`, `archived_at`, `archived_by`, index). Tests: `duplicates.pure.test.ts` (expenses, supplier-invoices — the harvest fixtures `duplicate-check-cases.json`), `inbox.pure.test.ts` (state mapping from `inbox-state-cases.json`), `documents.test.ts` (+ upload hash / duplicate / force, archive rules), `partner-match.pure.test.ts`, `e2e/document-inbox.spec.ts`, `e2e/document-review.spec.ts` (+ *Make it… → Expense*). Scale: hundreds of documents a year; the inbox is computed on request over the tenant's non-generated documents (cap 20 000 like the library).

## Constitution Check

- §1.2 linking is the product: *became* is the `created_from` link (D27), *justified* the `justifies` link; the inbox and *duplicate-of* are read models; the hash strategy of the duplicate check reads `created_from` links from the same-bytes documents. ✔
- §1.5 derived never typed: inbox state from `status` + `archived_at` + the links + `reviewed_at`; *duplicate of* from the hash; nothing stored but the hash and the parking flag (a flag with who / when, not a status value). ✔
- §1.6 immutable money: untouched — the dialogs pre-fill, the services write as before. ✔
- §1.4 no setting: tolerances (±1 %, ±7 days), the stuck threshold (5 min), the undo depth (20), the bulk limit (50) are constants; the keyboard map is code. ✔
- §2 import rules: `documents/components/make-it-section.tsx` imports `@/modules/expenses/ui`, `@/modules/supplier-invoices/ui`, `@/modules/partners/ui` (allowed: `/ui` surfaces). `expenses/ui` already imports `@/modules/documents/ui` (`settlements-table`) → a barrel cycle resolved at render time, harmless to Turbopack; if it ever bites, the review *page* composes the section instead. Server side: `expenses` / `supplier-invoices` call `documents.sameContentDocumentIds` and `linking.linksTouching` through the indexes; `documents` never imports them. ✔
- §2 one writer on `links`: nothing here writes links directly — creation goes through the modules' services, `Enter` through `linking.applySuggestion`. ✔
- §2 roles only via `can()`: every new action owner-gated (`ownerAction` / `can(caller, "update", "financial_document")`); the accountant's read-only inbox is `can(…, "read", …)` + `readOnly` props. ✔
- §3b archetypes: the inbox is the **work** archetype like `/banking/inbox` (list left, pane right, keyboard) on a plain list, not the DataTable — the DataTable is the *list* archetype's (the library keeps it). FR-018's "kernel table" is read as the kernel's work-page kit; the spec's behaviour is unchanged. ✔
- §4.5 screenshots: `/documents/inbox`, the review page with *Make it…*, the upload duplicate card, the blocking duplicate panel. ✔

## Data model

```
documents   + content_hash  char(64)?   sha256 hex of the stored bytes, set once (upload / generated); null on rows stored before this
            + archived_at   timestamptz?  archived_by uuid?   the parking flag; cleared on restore
            + INDEX (tenant_id, content_hash)      -- not unique: force allows a second copy
```

Derived, never stored (`documents/queries.ts`):

```
in_inbox      = status != 'generated' ∧ archived_at IS NULL ∧ reviewed_at IS NULL ∧ no created_from link points at it
inbox_state   = uploaded → needs_ocr · processing → processing (updated_at < now − 5 min → stuck) · ocr_failed → ocr_failed · extracted → ready
                archived_at set → archived (any pipeline status)
duplicate_of  = the oldest document (created_at asc) of the tenant with the same content_hash, when another exists; null for the oldest
counts        = pending (needs_ocr + processing + stuck + ocr_failed) · ready · duplicates (inbox rows with duplicate_of or a younger twin) · archived · total = pending + ready
became        = the created_from link's from (expense | supplier_invoice, id, key) — read through linking.linksTouching
```

Duplicate match (computed, `expenses/duplicates.ts`, `supplier-invoices/duplicates.ts`):

```
{ kind: 'exact' | 'hash' | 'fuzzy', confidence: 'high' | 'medium', entityType, entityId, entityKey, partnerName?, reason: MessageKey + params }
supplier_invoice:  A exact   partner_id = p ∧ norm(invoice_number) = norm(n)            → high   (norm: trim, collapse spaces, casefold — the unique index already lower()s)
                   B hash    created_from links from documents with the source's hash  → high
                   C fuzzy   partner_id = p ∧ currency = c ∧ |amount_total − a| ≤ 1 % a ∧ |invoice_date − d| ≤ 7 d → medium
expense:           B hash    as above (kind expense)                                   → high
                   C′ fuzzy  currency = c ∧ |amount − a| ≤ 1 % ∧ |date − d| ≤ 7 d ∧ (same partner when known, else casefold(description) = casefold(merchant)) → medium
dedupe by entityId (A ⊃ B ⊃ C), high first, max 5
```

Supplier match (`partners/match.ts`, pure scoring + one query): VAT exact (alnum, casefold) 100 · name exact 80 | contains 60 | Levenshtein ≤ 3 → 40 − 10·d · address contains 20 · vendor type 10; confidence = min(100, round(score / 140 × 100)); shown from 60 %; top 5.

## Services / files

**documents** — `documents.ts`: `uploadDocument(…, { force?: boolean })` computes the hash after `validateFile`, looks up `(tenant, hash)`; found and not forced → `{ data: { duplicate: DuplicateUploadRef } }` (nothing written); forced → stored, audit `newData.knowingDuplicateOf`. `storeGeneratedDocument` hashes too. `archiveDocuments(tx, caller, audit, clock, ids)` / `unarchiveDocuments` → `{ results: { id, outcome: 'archived' | 'restored' | 'refused', reason? }[] }`, refused unless `in_inbox` (archive) / `archived_at` set (restore); audited per document. `runOcr(tx, caller, audit, documentId, { force? })`: `ocr_failed` | stuck `processing` → status back to `uploaded`; `extracted` only with `force` (corrections kept, `ocrData` replaced); then the action enqueues `processDocumentJob` (`singletonKey = documentId`). `sameContentDocumentIds(tx, documentId): string[]` (index export). `queries.ts`: `listInbox(tx, caller, { tab, q })` → `InboxRow[]` (document facts as corrected, state, duplicateOf, became), `inboxCounts(tx, caller)`, `documentBecame(tx, id)`. `documents.actions.ts`: `uploadDocumentAction` (+ `force`), `archiveDocumentsAction`, `unarchiveDocumentsAction`, `runOcrAction`, `listInboxAction` (refresh). The review DTO gains `became`, `archivedAt`, `contentHash != null`. `scripts/backfill-document-hashes.ts` for the rows stored before the column (reads each blob once; idempotent).

**documents/components** — `file-upload-zone.tsx`: the duplicate card (*Use existing* → `/documents/<id>`, *Upload anyway* → re-post with `force`, owner only). `make-it-section.tsx`: *Expense* / *Supplier invoice* / *Just file it* (= `markDocumentReviewedAction`), renders the two dialogs with `initial` from the resolved OCR facts + `documentId`, the supplier match card, the *became* line; hidden for the accountant, for generated and for became. `document-review-client.tsx`: the section under the form; `document-review-header.tsx`: *Became {key}* chip. `inbox-workbench.tsx`: tabs with counts, search, the list, the pane (preview via `DocumentPreview`, facts, state, suggestions from `suggestionsForEntityAction`, actions by state), the selection, the undo stack (client, 20), the keyboard (the `isTyping` guard and `?` help as `/banking/inbox`), `readOnly` for the accountant.

**expenses** — `duplicates.ts` + `checkExpenseDuplicatesAction({ documentId?, partnerId?, merchant?, amount, currency, date })`; `expenseInputSchema` + `duplicateAck?: { entityIds: uuid[], note: string(min 1) }` → the note appended to `note`, audit `newData.duplicateAck`. `new-expense-dialog.tsx`: `initial?: Partial<{ date, description, amount, currency, vatAmount, documentId }>` prop, the duplicate panel (blocks on high until the note; warns on medium), runs the check on open and on blur of amount / date / description (debounced 400 ms). `expensePageOptions` unchanged.

**supplier-invoices** — `duplicates.ts` + `checkSupplierInvoiceDuplicatesAction({ documentId?, partnerId?, invoiceNumber?, amount?, currency?, date? })`; input `duplicateAck` as above. `new-supplier-invoice-dialog.tsx`: `initial?` (partnerId, invoiceNumber, invoiceDate, dueDate, currency, amountNet, vatAmount, amountTotal, documentId) + `supplierMatch?: { candidates, onCreateVendor }` slot for the match card; the duplicate panel.

**partners** — `match.ts` (`scorePartnerMatch` pure, `matchPartners(tx, { name?, vatNumber?, address? })`), `matchPartnersAction`; `createPartnerAction` reused for *New vendor* (name, vatNumber, address, types `['vendor']`).

**linking** — nothing new: `suggestionsForEntityAction({ type: 'document', id })`, `applySuggestionAction`, `linksTouching`. `kinds.ts` unchanged.

**dashboard** — `documents_to_review` → `href: '/documents/inbox'`.

**app** — `/documents/[id]/page.tsx` loads `expensePageOptions` + `supplierInvoicePageOptions(tx, auth, { documents: false })` + `documentBecame` and passes them to the client; `/documents/inbox/page.tsx` (`ListPage`, `can(read, financial_document)`, `InboxWorkbench`); `/documents/page.tsx` header link *Inbox (n)*; topbar `CRUMB_KEYS['/documents/inbox']`.

**i18n** — `documents.makeIt.*`, `documents.duplicate.*` (upload card, panel, reasons), `documents.inbox.*` (tabs, states, actions, help, toasts, empty states), `partners.match.*`; en / fr / sv in the same PR (serialised with any other dictionary PR).

**docs** — `docs/document-review.md` (*Make it…*, filed), `docs/document-upload.md` (hash, duplicate), new `docs/document-inbox.md` (states, counts, keyboard, undo, archive rules), `docs/expenses.md` + `docs/supplier-invoices.md` (duplicate check, `duplicateAck`), `docs/partners.md` (match), `docs/index.md`, `docs/roadmap.md` (A1 ticked), `feature-inventory.md` §3.9 status.

## Part 1 — `feat/documents-become`

Migration · hash on upload + generated · duplicate card · `sameContentDocumentIds` · `duplicates.ts` × 2 + actions + `duplicateAck` · `initial` props + duplicate panel in both dialogs · partner match + *New vendor* · `make-it-section` + review page composition + *became* in header / library · backfill script · tests · e2e (review spec: *Make it… → Expense*; library spec: duplicate card) · docs.

## Part 2 — `feat/documents-inbox`

Archive / unarchive / runOcr services + actions · inbox read model + counts · `inbox-workbench` + page + nav link + crumb · dashboard href · undo · keyboard · accountant read-only · `e2e/document-inbox.spec.ts` (three uploads: OCR'd, failed, duplicate → tabs count; `j`/`k`; `d` + `u`; `e` opens the dialog) · screenshots · docs.

## Risks / notes

- The mock OCR (CI, dev without DI keys) always succeeds: the e2e's *OCR failed* row is produced by a non-PDF payload the validator accepts but the OCR refuses, or by the job's dead-letter path — decide in tasks after reading `process-document.test.ts`.
- `uploadDocumentAction` returns a union now (`stored | duplicate`); the three callers (`file-upload-zone`, the e2e helpers, the seed) are updated in the same PR.
- The sha256 of a 20 MB PDF is ~20 ms; no job needed.
- Rows stored before the column have `content_hash = null` until the backfill runs; they never match (documented; the owner's real data starts after this ships).
