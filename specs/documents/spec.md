# Feature Specification: Document inbox — what a document becomes, duplicates, the work queue

**Feature Branch**: `feat/documents-become` (part 1: *Make it…* on the review page, the upload duplicate, the entity duplicate check) · `feat/documents-inbox` (part 2: the inbox work page, archive + undo, the keyboard)

**Created**: 2026-10-21

**Status**: Ready for the owner's read, then planning (Q1–Q7 of the harvest answered → D27, D32; harvest `specs/documents/harvest.md`; the roadmap's A1)

**Input**: "From the review page, make a receipt an expense or an invoice a supplier invoice (`created_from`, D27); upload-time duplicate (same hash → *Use existing* / *Upload anyway*, D32); entity duplicate check before creating (high blocks with a note, medium warns); the inbox work page with queue states, counts, archive + undo, the keyboard map `j k x a o i e l d r z u ? Enter 1-3`; accountant read-only."

## What exists today, what this adds

Today a receipt is uploaded, OCR'd, reviewed on `/documents/<id>`, and then the owner goes to `/expenses` → *New* → picks the document from a list — two pages, a search, and nothing tells him a file arrived twice. This feature closes the loop: **on the review page the document becomes the thing it is** (an expense, a supplier invoice, or just filed), **an identical file is recognised at upload**, **a second invoice for the same thing is caught before it is created**, and **the inbox** shows every document that still needs a decision, driven from the keyboard like `/banking/inbox`.

```
upload ──► OCR ──► review ──► Make it… ──► expense / supplier invoice (created_from)
  │ same bytes?                 │ Just file it ──► reviewed, nothing created
  └► Use existing / Upload anyway        └ Archive ──► parked (undo)
inbox = documents with none of these decisions taken yet
```

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The receipt becomes an expense, the invoice a supplier invoice (Priority: P1)

The owner opens an extracted receipt on its review page. Under the review form the right pane offers **Make it…**: *Expense*, *Supplier invoice*, *Just file it*. He picks *Expense*: the expense dialog opens already filled from the OCR facts as corrected — date, amount, currency, VAT, the merchant as description — with the document pre-selected; he picks the group, the BAS category and *paid by*, clicks *Create*. The expense `Ex213-Tr-04` exists, the review page now reads *Became expense Ex213-Tr-04* with a link, the *Make it…* buttons are gone, and the document has left the inbox. For a supplier invoice the same, with a **supplier match** on top: the OCR vendor name / VAT number against his partners — *Use match*, *Create new partner* (pre-filled), or search — then number, dates, amounts, category, group. *Just file it* marks the document reviewed with nothing created (a bank statement, a contract, a certificate).

**Why this priority**: it is the step the monthly rhythm is missing; everything else in this feature exists to feed it.

**Independent Test**: upload a receipt, open it, *Make it… → Expense*, create; the expense carries the document, the document says what it became, the inbox no longer lists it.

**Acceptance Scenarios**:

1. **Given** an extracted receipt (OCR: merchant *SBB*, 2026-03-04, 86.00 CHF, VAT 6.44) with the amount corrected to 85.00 on review **When** the owner chooses *Make it… → Expense* **Then** the dialog opens with date 2026-03-04, amount 85.00, currency CHF, description *SBB*, the document pre-selected and *document missing* unchecked; group, category and *paid by* are his to pick.
2. **Given** that dialog completed **When** he clicks *Create* **Then** the expense exists with its key, the `created_from` link exists (expense → document), the review page shows *Became expense {key}* linking to the expense, no *Make it…* buttons remain, and the audit trail records the creation with the document.
3. **Given** an extracted supplier invoice (vendor *Skattepunkten AB*, VAT SE5566…, number 9160, 1 297.20 SEK) **When** he chooses *Make it… → Supplier invoice* **Then** the supplier match shows the best partner with its confidence (VAT exact → *Use match* first), the invoice number, dates, net / VAT / total and currency are pre-filled, and the created invoice carries the document and the `created_from` link.
4. **Given** no partner matches the vendor **When** he chooses *Create new partner* **Then** the partner form opens pre-filled with the OCR name, VAT number and address, type *vendor*, and on save the supplier-invoice dialog continues with that partner selected.
5. **Given** a document that already became something **When** anyone opens it **Then** the page shows what it became and offers no *Make it…*; **and when** that expense or supplier invoice is deleted **Then** the `created_from` link goes with it and the document is back in the inbox as *ready*.
6. **Given** a contract uploaded under the *contract* kind **When** the owner chooses *Just file it* **Then** the document is marked reviewed, nothing is created, it leaves the inbox; *Link to…* (belongs to a partner) stays available as today.
7. **Given** the accountant on a review page **When** the page renders **Then** there is no *Make it…*, exactly as there is no *Mark as reviewed* for him today.

---

### User Story 2 - The same file twice (Priority: P1)

The owner uploads a PDF the app already has (email + photo, a re-upload after a crash, the same ticket from two trips). Nothing is stored; a card says *Duplicate document detected* with the existing document's key, upload date, uploader and — when it already became something — *Became expense Ex213-Tr-04*. *Use existing* opens that document; *Upload anyway* (owner only) stores a second copy, recorded as such.

**Why this priority**: duplicates are how a receipt gets expensed twice; catching them at the door is the cheapest check there is.

**Independent Test**: upload the same bytes twice; the second upload stores nothing and shows the card; *Use existing* lands on the first document.

**Acceptance Scenarios**:

1. **Given** a stored document **When** a file with identical bytes is uploaded, whatever its name or kind **Then** nothing is written, and the card shows the existing key, date, uploader and what it became.
2. **Given** the card **When** *Use existing* is clicked **Then** the existing document's review page opens.
3. **Given** the card and the owner **When** *Upload anyway* is clicked **Then** a second document is stored with its own key, the audit trail notes it as a knowing duplicate, and the inbox's *Duplicates* tab lists both, the newer one captioned *Duplicate of {older key}*.
4. **Given** a generated PDF (an issued invoice's) **When** it is stored **Then** it also carries a content hash, so a re-upload of the client's own copy is recognised.
5. **Given** a document deleted (hard delete, as today) **When** its bytes are uploaded again **Then** it is a normal upload — a deleted document never counts as a duplicate.

---

### User Story 3 - The same invoice twice (Priority: P2)

Before an expense or a supplier invoice is created from a document (US1), the app looks for the entity that may already exist: a supplier invoice with the **same partner and number**; **the same bytes** already turned into the same kind of entity; a **similar** one — same partner, same currency, amount within 1 %, date within 7 days (for expenses: same currency, amount within 1 %, date within 7 days, and the same partner or the same merchant name). A *high* match blocks the dialog with *Possible duplicate detected*, the reason, a link to the existing entity, and *Create anyway* which requires a note; a *medium* match only warns inline.

**Why this priority**: the check costs nothing and the accountant package is where a double booking would otherwise surface — months later.

**Independent Test**: create a supplier invoice from a document, then open a second document with the same partner and number; the dialog is blocked until *Create anyway* with a note.

**Acceptance Scenarios**:

1. **Given** supplier invoice 9160 of *Skattepunkten AB* exists **When** *Make it… → Supplier invoice* is chosen on a document whose OCR number is `9160` (or ` 9160`, or `9160 ` — trimmed, spaces collapsed, case-folded) and the match card resolved the same partner **Then** a *high* match blocks with *Invoice #9160 from Skattepunkten AB already exists* and a link to it.
2. **Given** the block **When** the owner types a note (*the October copy, different period*) and clicks *Create anyway* **Then** the invoice is created, the note is stored on it and the audit trail carries it; without a note the button stays disabled.
3. **Given** the same bytes already became expense `Ex213-Tr-04` (via *Upload anyway*) **When** *Make it… → Expense* is chosen on the copy **Then** a *high* match says *This exact file was already used to create expense Ex213-Tr-04*.
4. **Given** a supplier invoice of the same partner, 1 290.00 SEK, dated 5 days earlier **When** the dialog opens with 1 297.20 SEK **Then** a *medium* match warns inline (*Similar invoice exists: #9158 for 1 290.00 SEK on 2026-07-03*) and *Create* stays enabled; the same amounts in CHF do not match; 1.5 % off or 8 days off do not match.
5. **Given** several matches **When** shown **Then** each existing entity appears once, *high* before *medium*, at most five.

---

### User Story 4 - The inbox: everything that still needs a decision (Priority: P2)

`/documents/inbox` is the documents work page: the queue left, the selected document right. Tabs with counts — *All (n)*, *Pending (n)* (needs OCR, OCR running, OCR failed), *Ready (n)* (extracted, nothing decided), *Duplicates (n)*, *Archived (n)*; the title says *{n} documents need attention*. The right pane shows the preview, the extracted facts, the state, and the actions the state allows: *Run OCR* for pending and failed rows, *Make it… Expense / Supplier invoice / Just file it* and *Link to…* for ready rows, *Archive* for any inbox row, *Restore* on the archived tab, *Open* always. The keyboard drives it; archive and restore can be undone (`u` or `z`) until the page is left. A row leaves the inbox when the document became something (US1), was filed (reviewed with nothing created), or was archived.

**Why this priority**: the review page alone closes the loop for one document; the inbox is where the month's pile gets worked through in one sitting.

**Independent Test**: upload three files (one OCR'd, one failed, one duplicate); the tabs count them; `j`/`k` walk them; `d` archives the open one and `u` brings it back.

**Acceptance Scenarios**:

1. **Given** documents in every state **When** the inbox opens **Then** *Pending* = uploaded + processing + OCR failed, *Ready* = extracted and not reviewed / became / archived, *Duplicates* = inbox rows whose bytes exist more than once (captioned *Duplicate of {oldest key}*), *Archived* = parked rows, *All* = pending + ready; generated PDFs never appear; counts ignore the filters.
2. **Given** a row processing for more than five minutes **When** listed **Then** it is captioned *Processing seems stuck* and *Run OCR* is offered.
3. **Given** the keyboard, outside any input or dialog **When** `j` / `k` (or ↓ / ↑) **Then** the next / previous row opens in the pane, wrapping; `x` toggles the row's checkbox, `a` selects all visible / none; `o` runs OCR on the open pending or failed row; `i` / `e` open *Make it… Supplier invoice / Expense* for the open ready row; `l` opens *Link to…* for the selection or the open row; `d` archives the selection, else the open row (not on *Archived*); `r` restores the selection on *Archived*, else refreshes; `u` or `z` undoes the last archive / restore; `Enter` links the top bank-row suggestion when it is *high*, `1`–`3` the nth; `?` toggles the help; `Esc` closes help → dialog → pane → selection, first that applies.
4. **Given** five rows selected, one of which already became an expense **When** `d` **Then** four are archived, the fifth refused (*archive is only for inbox rows*), the toast says *Archived 4 documents, 1 refused*, the undo entry holds exactly the four, and `u` restores exactly those.
5. **Given** an archived row **When** restored **Then** it returns in its pipeline state (ready, or pending if OCR never completed) — nothing else changes.
6. **Given** a ready row with bank-row suggestions **When** `Enter` on a *high* one **Then** the bank row justifies the document (the linking module's link, the allocation proposed), exactly as *Link* on `/banking/inbox` does; a *medium* top suggestion needs `1`.
7. **Given** the accountant **When** he opens the inbox **Then** he reads the queue and the pane, financial documents only, with no action button and the help listing only `j k ? Esc`; `d`, `o`, `i`, `e`, `l`, `Enter` do nothing.
8. **Given** the dashboard's *documents to review* item **When** clicked **Then** it opens the inbox, not the library.

---

### Edge Cases

- The same bytes uploaded under another kind (receipt first, then as *invoice*): still a duplicate — bytes decide, the kind is the owner's to change on review.
- OCR failed and the owner still wants the expense: *Make it…* works on a failed row; the dialog opens empty but for the document.
- A document became an expense, the expense is deleted: the link goes, the document is *ready* again (US1-5); its corrections and review mark stay.
- *Upload anyway* twice: three documents, two captioned *Duplicate of* the oldest.
- *Create anyway* on a *high* hash match creates a second expense from a second copy of the same bytes — allowed, noted, audited; the package shows both under their keys.
- Undo after reload: gone (the stack is the page's); an undo whose documents were resolved meanwhile (one became an expense) restores the others and says so.
- A relationship document (contract, NDA): in the inbox until filed or linked; invisible to the accountant as today.
- Retention: nothing here deletes; the delete guard of the library is untouched.
- Two owners (two tenants) never see each other's duplicates: the hash is matched within the tenant.

## Requirements *(mandatory)*

### Functional Requirements

**Becoming something (US1)**

- **FR-001**: The review page MUST offer the owner *Make it… → Expense / Supplier invoice / Just file it* on every document that has not become anything, is not generated, and is not archived; the accountant never sees it.
- **FR-002**: *Expense* and *Supplier invoice* MUST open the modules' existing creation dialogs with the document pre-selected and the fields pre-filled from the OCR facts **as corrected on review** (date, amounts, currency, VAT, number, merchant / vendor); *document missing* is off.
- **FR-003**: *Supplier invoice* MUST first match the OCR vendor (name, VAT number, address) against the partners and offer *Use match* (with the confidence), *Create new partner* pre-filled, or a search; a new partner is created as a vendor before the invoice.
- **FR-004**: Creating the entity MUST write the `created_from` link (D27), one origin per document; a document that already became something MUST be refused as an origin.
- **FR-005**: After creation the review page and the library MUST show what the document became, with a link; the document MUST leave the inbox.
- **FR-006**: *Just file it* MUST mark the document reviewed with nothing created, and that alone MUST take the document out of the inbox.
- **FR-007**: Deleting the created entity MUST remove the `created_from` link and return the document to the inbox.

**Identical files (US2)**

- **FR-008**: Every stored document, uploaded or generated, MUST carry the hash of its bytes, set once.
- **FR-009**: An upload whose bytes match a stored document of the tenant MUST store nothing and return the existing document (key, date, uploader, what it became) for the card.
- **FR-010**: *Use existing* MUST open the existing document; *Upload anyway* MUST be available to the owner only, store a second document, and be audited as a knowing duplicate.
- **FR-011**: The inbox MUST derive *Duplicate of {key}* for every inbox row whose bytes occur more than once, naming the oldest; nothing about duplicates is stored beyond the hash.

**Same entity twice (US3)**

- **FR-012**: Before a supplier invoice is created from a document the app MUST check: same partner + same number (normalised: trimmed, spaces collapsed, case-folded) → *high*; same bytes already became a supplier invoice → *high*; same partner, same currency, amount within ±1 %, date within ±7 days → *medium*.
- **FR-013**: Before an expense is created from a document the app MUST check: same bytes already became an expense → *high*; same currency, amount within ±1 %, date within ±7 days, and the same partner or the same merchant name (case-folded) → *medium*.
- **FR-014**: Matches MUST be de-duplicated by entity, ordered *high* then *medium*, at most five, each with a human reason and a link to the entity.
- **FR-015**: A *high* match MUST block creation until *Create anyway* with a non-empty note; the note MUST be stored on the created entity and in the audit trail. A *medium* match MUST warn without blocking.

**The inbox (US4)**

- **FR-016**: The inbox MUST list the tenant's documents that are not generated, not archived, have not become anything and are not reviewed; its state per row MUST be derived from the pipeline status (*needs OCR* = uploaded, *processing* = processing, *OCR failed*, *ready* = extracted) plus the archived flag; *stuck* = processing for more than five minutes.
- **FR-017**: The tabs MUST be *All / Pending / Ready / Duplicates / Archived* with counts computed over the whole inbox, ignoring the active filters; the title MUST say how many documents need attention (pending + ready).
- **FR-018**: The page MUST be the work archetype (list left, selected document right, keyboard first) on the kernel table; the pane MUST show the preview, the extracted facts, the state, the bank-row suggestions (top three, from the linking module) and the actions the state allows.
- **FR-019**: *Archive* MUST set a parked flag (with who and when, audited) on inbox rows only, singly or in bulk (≤ 50), reporting per document; *Restore* MUST clear it; neither MUST touch the pipeline status, the review mark or any link.
- **FR-020**: Archive and restore MUST be undoable from the page (`u` / `z`, or the *Undo* bar) until the page is left, restoring exactly the documents that succeeded; the stack holds at most 20 entries.
- **FR-021**: *Run OCR* MUST re-run the OCR job on a pending or failed row (one job per document at a time); on a completed row it MUST require an explicit *re-run* from the review page.
- **FR-022**: The keyboard MUST be `j k ↓ ↑ x a o i e l d r u z Enter 1 2 3 ? Esc` as in US4-3, ignored while typing or while a dialog is open except `Esc`; `?` MUST show the map.
- **FR-023**: The accountant MUST see the inbox and the pane read-only (financial documents only), with no action and no writing shortcut.
- **FR-024**: The dashboard's *documents to review* item MUST open the inbox.

**Everywhere**

- **FR-025**: Every write here MUST be audited (became, filed, upload-anyway, create-anyway with its note, archive, restore, OCR re-run).
- **FR-026**: Every string MUST exist in en, fr and sv.

### Key Entities *(include if feature involves data)*

- **Document** (existing): gains a **content hash** (set once) and an **archived** mark (when, by whom; cleared on restore). No new status value: the pipeline statuses stay what they are; *reviewed*, *became*, *archived* are facts beside it.
- **Inbox row** (derived, never stored): the document, its **inbox state** (`needs_ocr | processing | stuck | ocr_failed | ready | archived`), *duplicate of* (the oldest document with the same bytes), the extracted facts as corrected, the top bank-row suggestions.
- **Duplicate match** (computed, never stored): kind (`exact | hash | fuzzy`), confidence (`high | medium`), the existing entity (type, id, key), partner name, reason.
- **Link `created_from`** (existing, D27): expense / supplier invoice → document, one origin per document; removed with the entity.
- **Audit entries** (existing): one per write listed in FR-025, with the note of a *Create anyway*.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A receipt goes from upload to an expense with its key without leaving the review page, in under a minute, with no retyping of date, amount, currency or VAT when the OCR read them.
- **SC-002**: Uploading a file the app already holds stores nothing, 100 % of the time, and the owner reaches the existing document in one click.
- **SC-003**: A second supplier invoice with the same partner and number cannot be created without a written reason; the reason is in the audit trail.
- **SC-004**: The month's pile of twenty documents is worked through on the inbox from the keyboard alone — no mouse needed for navigate, OCR, make-it, archive, undo.
- **SC-005**: The inbox counts match the library's status chips and the dashboard's *documents to review* on the same data.
- **SC-006**: The accountant can read everything on the inbox and change nothing; every writing path refuses him.

## Assumptions

- **Inbox membership = no decision yet**: a document leaves the inbox when it became something, was filed (reviewed with nothing created), or was archived. *Mark as reviewed* on the review page therefore also files a document — the review is the decision. (The harvest's `status != linked` becomes this; v3 has no `linked` status.)
- Decisions D27 (`created_from` link kind, no fields on the document) and D32 (upload duplicate choice, fuzzy ±1 % / ±7 days / same partner + currency, *Create anyway* needs a note, two OCR quality levels, archive only inbox rows, the keyboard map) are taken; this spec applies them.
- The creation dialogs of expenses and supplier invoices already take a document and write the `created_from` link; this feature pre-fills them and reaches them from the review page and the inbox. No wizard, no separate "company purchase" kind (D9).
- The supplier match scoring is the harvest's (VAT exact 100, name exact 80 / contains 60 / near 40−10·distance, address 20, role 10; shown from 60 %); it lives with the partners.
- Bank-row suggestions for a document are the linking module's existing scorer; `Enter` applies the same link *Link* applies on `/banking/inbox`.
- OCR quality stays two levels (high / low). Bulk OCR is not offered: `o` runs one document; a pile of failed OCRs is rare at this volume.
- No email, no notifications; the inbox and the dashboard item are the only "you have work" signals.
- The library keeps its delete guard; nothing here deletes a document.

## Out of scope

v1's processing wizard and queue page, the `?createEntity=` navigation, the *Link to entity* modal with link types (the linking module's *Link to…* exists), bulk link, bulk OCR, user-scoped visibility (`uploadedBy = me`), a third OCR quality level, amount filters, auto-refresh.
