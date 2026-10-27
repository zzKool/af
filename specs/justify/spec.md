# Feature Specification: Justify from the bank row (F97)

**Feature Branch**: `feat/linking-justify` (the panel, the compare card, the composite action — one PR) · `feat/linking-payment-picker` (US2: the suggestions replace the payment `<Select>`) · `feat/nav-work` (the nav rename, the nav file alone)

**Created**: 2026-10-27

**Status**: Spec — the owner read the review and said *go* (2026-10-27: "the Justify panel on that row"); built on the one transaction table (F113, D59)

**Input**: [[review-2026-10-26]] §1.1–1.4, §2: "select a transaction and upload a supplier invoice; DI extracts; done." Swedish bookkeeping is proof-per-transaction: the row is the fact, the document is its evidence. Today the proof always starts on `/documents`; the row offers *links · transfer · create rule* and the inbox *l = Link to…*, *c = categorise*.

## The target

```
 Work (= /banking/inbox)             row  2026-07-08  −1 297.20 SEK  "SKATTEPUNKTEN OFFICE"   open
 ┌─ Justify ───────────────────────────────────────────────────────────────────────┐
 │ p  Drop the proof here / choose a file  → OCR → compare card → Create & link    │  US1 (new)
 │    Pick a document already in the inbox, scored            (SuggestionsSection) │  US2 (exists)
 │ l  Pick an expense / supplier invoice, scored, searchable  (SuggestionsSection) │  US2 (exists + the picker)
 │ n  No proof needed: fee · transfer leg · tax · salary · interest · other       │  US3
 │ x  Receipt lost: create the entity without a document, flagged                 │  US3
 └─────────────────────────────────────────────────────────────────────────────────┘
                                   ▼ one transaction
   document (key) ── created_from ── supplier invoice | expense ◄── justifies (full allocation) ── row
                                                                   the row's partner + BAS set by the same click
```

One component (`modules/linking/components/justify-panel.tsx`), rendered by the banking panel and the inbox's right pane (both already render `SuggestionsSection` from linking). Composition lives in `modules/linking`; every write goes through the owning module's service (documents upload, supplier invoices / expenses create and pay, banking categorise, partners create) — linking adds the one transaction around them and the compare rule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Justify a row with a new file (Priority: P1)

The owner selects an open outgoing row, presses `p` (or drops a file on the panel). The file is uploaded as a financial document (the existing upload: duplicate check, key, OCR job). The panel waits for the reading (`extracted`, polled; `ocr_failed` falls through to the card with empty readings), then shows the **compare card**:

```
 document   1 297.20 SEK   2026-07-06   Skattepunkten Office Services AB   VAT SE5566…   invoice 2026-071
 row       −1 297.20 SEK   2026-07-08   SKATTEPUNKTEN OFFICE
 amount equal ✓ · 2 days ✓ · partner Skattepunkten Office Services AB (match 100 %) ✓ · supplier invoice
 [ Create supplier invoice & link ]   [ as an expense instead ]   [ fix the reading → ]
```

One click writes, in one transaction: the entity (pre-filled from the reading as corrected and from the row), its `created_from` link to the document, the payment (the module's own payment path — the `justifies` link with the full allocation, D37), and the row's facts (partner, BAS — `categorised_by = manual`: the owner's one click is the categorisation). Then the inbox moves to the next row (`j`).

**Why this priority**: the product (review §0, §1.1). Every other story shortens this one.

**Independent Test**: the compare rule and the pre-fill on fixtures (pure); the composite action on a seeded row with the mock OCR (DB: the entity, two links, the row's facts, one audit set; a failure after the upload leaves the document and nothing else); the e2e journey with `e2e/fixtures/pdf.ts` under `OCR_PROVIDER=mock`.

**Acceptance Scenarios**:

1. **Given** an open row −1 297.20 SEK 2026-07-08 "SKATTEPUNKTEN OFFICE" and a dropped PDF the OCR reads as 1 297.20 SEK, 2026-07-06, *Skattepunkten Office Services AB*, invoice 2026-071 **When** the owner clicks *Create supplier invoice & link* **Then** one supplier invoice exists (number 2026-071, date 2026-07-06, due date defaulted, 1 297.20 SEK, partner the matched supplier, BAS the partner's default else the rule's else none, group the row's month), the document is renamed to its key and `created_from` it, the row `justifies` it with 1 297.20 SEK, the row's `partner_id` is the supplier and `bas_code` the invoice's, `categorised_by = manual`; the row's state is *linked*; the inbox shows the next row.
2. **Given** the reading says 1 290.00 and the row −1 297.20 **Then** the card shows *amount off by 7.20 SEK* and still offers the button; the entity carries the reading's amount, the link allocates the row's |amount| (the module's cross-amount rule: the invoice shows *partially paid* or *overpaid* as its own derivations say) — never a block.
3. **Given** a CHF reading on an SEK row **Then** the card shows both amounts and the SEK base, the button creates the entity in CHF and pays it through the module's cross-currency path (`attachPayment` / `attachBankTransaction`: the row's base becomes the entity's base, `rate_source = bank`, D26).
4. **Given** no partner matches ≥ the match threshold **Then** the card shows the vendor name read with *New supplier* (one inline field, pre-filled) — the click creates the partner first (`partners.createPartner`, type by the entity kind), the name written back as the document's `vendorName` correction (review §1.3c), then the rest.
5. **Given** the reading has no invoice number and no VAT number, or the row's counterparty is a card purchase (`Kortköp …`) **Then** the card proposes *expense* (group = the row's month's group, created when missing; payer = the payment source of the row's account); *as a supplier invoice instead* flips it. The rule `proposeKind` is pure and tested.
6. **Given** the OCR fails or times out (60 s) **Then** the card opens with empty readings and the row's facts; the owner types the two or three fields the entity needs (amount pre-filled from the row); the document stays attached.
7. **Given** the upload is a duplicate (same bytes) **Then** the existing document is offered instead (the upload's own duplicate card) — the compare card runs on it.
8. **Given** the composite action fails after the entity was created (a link refused, a lock) **Then** nothing is kept but the uploaded document (its own transaction, before); the error names the step.
9. **Given** the accountant **Then** no Justify panel; the sections stay read-only.

---

### User Story 2 - Justify with what exists: the scored picker replaces the dropdown (Priority: P1)

On the row: *Pick a document* and *Pick an entity* are the `SuggestionsSection` as today (candidates with confidence and reasons, *Link*, *Link to…* search). On the entity side: *Link payment* on a supplier invoice and *Attach bank row* on an expense stop being a `<Select>` of every open row; they show the entity's scored rows (`suggestionsForEntity`, top 5 with reasons) and a search (text, amount ±, date) over the rest — one component, `PaymentPicker`, that calls the module's own payment action.

**Acceptance Scenarios**:

1. **Given** a supplier invoice of 1 297.20 SEK and an open row −1 297.20 SEK two days later **Then** the picker shows it first, HIGH, *Exact amount match · 2 days*; one click records the payment through `recordPayment`; the Select is gone (`payableTransactions` no longer serves the UI).
2. **Given** no candidate **Then** the search finds a row by text, by amount (±1 %) or by date; the result links the same way.
3. **Given** a document in the inbox that scores HIGH for the row **Then** the row's Justify panel offers it first with *Make it… & link* — the compare card on an existing document (US1's card, the upload step skipped).

---

### User Story 3 - No proof needed, and the receipt that is lost (Priority: P2)

`n` opens the reasons: *bank fee · transfer leg · tax / Skatteverket · salary / owner · interest · other*. Each sets `no_document_needed` on the row with the reason's BAS (fee 657, interest 831, tax 2510/2710 family through the owner's active set, salary 7xxx — proposed, editable) through `banking.categorise` by hand; *transfer leg* opens the transfer proposal instead (it is a link, D44). After the first by-hand categorisation of a counterparty that has no rule, a toast proposes the rule (*Always 657 · no document for AVGIFTER NORDEA?* — one click = `createRuleFromTransaction`).

`x` (*Receipt lost*): the compare card without a document — the entity created from the row's facts alone with `document_missing = true`, paid by the row, the row's facts set; the package flags it as today.

**Acceptance Scenarios**:

1. **Given** an open fee row **When** `n` → *bank fee* **Then** the row is *no document*, BAS 657, `categorised_by = manual`; the toast proposes the rule; accepting creates a `learned` rule applied to the row.
2. **Given** `x` on a card row −45.00 CHF **Then** an expense of 45.00 CHF with `document_missing`, payer the row's account, group the row's month, paid by the row (D26), the row's partner from the counterparty's rule if any; the inbox moves on.
3. **Given** a row already *no document* **Then** `n` offers *document needed again* (clears the flag).

---

### User Story 4 - Work is the first menu item (Priority: P3)

`/banking/inbox` becomes **Work**: the first item in the sidebar with the counts (F72), the banking list, documents, partners and the rest under *Records*. A nav-file-only PR with its strings; `/banking/inbox` keeps its path (bookmarks, the e2e).

**Acceptance Scenarios**:

1. **Given** the owner **Then** the sidebar reads *Work · Banking · Documents · Partners · …*; the badge on *Work* is `rowsToJustifyCount` (+ the documents inbox's count, one number).
2. **Given** the accountant **Then** no *Work* (writes only).

---

### User Story 5 - The document is read-only once it became something (Priority: P3)

A document that `became` an expense or a supplier invoice shows the entity's facts on its page — the review form read-only with *Edit on the supplier invoice →* — so the two copies never diverge (review §1.3b). *Fix the reading* on the compare card is the only path into the form before the click.

**Acceptance Scenarios**:

1. **Given** a document with a `created_from` link **Then** `/documents/[id]` renders the fields disabled, a banner *This document became SI213-Acc-01 — edit it there*, the link; `updateDocumentCorrectionsAction` refuses (`BUSINESS_RULE_VIOLATION`) for such a document.

---

### Edge Cases

- A row already partly allocated: the card allocates what is left; the entity amount stays the reading's.
- An incoming row (a client paid): the panel offers *Pick an invoice* (the suggestions) and *No proof needed* only; `p` is disabled with the reason — the proof of income is the issued invoice (F93 search finds it).
- The row is a savings-account row: *No proof needed* only (the statement is the proof, D13).
- Two files dropped: the first runs; the others queue in the panel (one row, one proof — a second file on the same row is refused with *this row is justified*).
- The OCR mock (`OCR_PROVIDER=mock`) reads invented facts: the e2e asserts the mechanics (the entity, the links, the row's facts), not the values.
- The subscriptions matcher (F94, on probation): untouched; a row it would match still shows its *match waiting* on the subscription page. If F104 retires it, the template's pre-fill folds into the card's pre-fill (one function, `prefillFromRow`).

## Requirements *(mandatory)*

- **FR-001** `modules/linking/justify.ts` (pure + service): `compareRowToDocument(row, reading) → CompareCard` (amount equal / off by Δ in the row's currency and in SEK / other currency with both bases; days between; the partner match from `partners.matchPartners` with its score; the proposed kind), `proposeKind(row, reading)` (invoice number or VAT number → `supplier_invoice`; a card purchase (`stripCardPrefix` changed the key) or nothing read → `expense`), `prefillFromRow(row, reading, kind)` → the module's `…Initial` (amount, currency, dates, partner, group = the row's month, payer = the row's account's payment source, BAS = partner default → rule → none; `document_missing` when no document), `justifyWithDocument(tx, caller, audit, input)` — the composite: partner (create when `newPartner`), entity (`supplierInvoices.createSupplierInvoice` / `expenses.createExpense` with `documentId`), payment (`recordPayment` / `attachPayment` / `attachBankTransaction` by currency), `banking.categorise(by hand)`, one audit set; every step a `ServiceResult`, a returned error rolls back (F111). `justifyWithoutDocument` = the same with `document_missing`. No new table.
- **FR-002** `justifyWithDocumentAction` (owner), `justifyWithoutDocumentAction`, `noProofNeededAction({transactionId, reason})` (the reasons → BAS table in `justify.ts`, data) — on `ownerAction`; the upload stays `uploadDocumentAction` (its own transaction: the document survives a failed justification).
- **FR-003** `JustifyPanel` (client): the drop zone (`FileUploadZone` from documents' ui), the OCR wait (`getDocumentForReviewAction` polled every 2 s, 60 s cap), the `CompareCard`, the reasons menu, the keyboard (`p` proof · `n` no proof · `x` lost — registered through the inbox's existing key handler; on the banking panel the buttons alone), the *New supplier* inline field, *Fix the reading →* (the review page). Rendered by `TransactionDetailView` (banking) above *Suggestions* and by the inbox's right pane; hidden for the accountant and on a *linked* / *no document* row.
- **FR-004** `PaymentPicker` (US2): `suggestionsForEntity` + `searchRowsAction({ text?, amount?, tolerance?, dateFrom?, dateTo? })` (a banking read, `outgoingMainRows` filtered — or one new read `searchOutgoingRows`); replaces the `<Select>` in `supplier-invoice-panel-payments.tsx` and `expense-panel-payments.tsx`; `payableTransactions` deleted from the UI path.
- **FR-005** US3's rule proposal: after `categorise` by hand on a row whose counterparty key matches no active rule, the action returns `proposeRule: { name, basCode, noDocumentNeeded }`; the toast's click calls `createRuleFromTransactionAction`.
- **FR-006** US5: `updateDocumentCorrectionsAction` refuses a document with a `created_from` link; the review client renders read-only with the banner; the compare card's *Fix the reading* goes there before the click only.
- **FR-007** Nav (US4, its own PR): `/banking/inbox` labelled *Work*, first, group `work`; the count = rows to justify + documents to review; `nav.*` keys.
- **FR-008** Tests: `justify.pure.test.ts` (the compare rule: equal / off / other currency / no reading; `proposeKind` on the fixtures' rows; `prefillFromRow`), `justify.test.ts` (DB: the composite on seeded rows — supplier invoice and expense, SEK and CHF, new partner, lost receipt; the rollback on a refused step; RLS; the accountant refused), `payment-picker.test.tsx`, e2e `justify.spec.ts` (`OCR_PROVIDER=mock`: drop the fixture PDF → the card → the click → the row linked → the next row; `n` on a fee; `x` on a card row), screenshots of the panel, the card and the picker light + dark.
- **FR-009** Docs: `docs/linking.md` (the Justify section), `docs/banking.md` (the panel's section), `docs/document-review.md` (read-only once became), `docs/features.md` F97, D33 → D58 noted as applied by the click (F113 PR C still derives for links made elsewhere).

## Success Criteria *(mandatory)*

- **SC-001** A month of rows is justified without leaving Work: every outgoing row ends *linked* or *no document* from the panel — the e2e journey does three rows (proof, no proof, lost) in one sitting.
- **SC-002** Under a minute per row with a proof (upload → card → click, the OCR's time included at the mock's speed; on the box the DI call), under ten seconds without.
- **SC-003** After the click: one entity, exactly two links (`created_from`, `justifies`), the row's `partner_id` / `bas_code` set with `categorised_by = manual`, the document renamed to the key — asserted in `justify.test.ts`.
- **SC-004** The payment `<Select>` is gone from both panels; the supplier-invoices and expenses e2e journeys link through the picker.
- **SC-005** No new table, no new link kind, no new status: the composite calls the four modules' existing services; `kernel/guards` green.

## Assumptions

- The OCR reading of a supplier invoice carries amount, currency, date, vendor name, VAT number and invoice number when present (`OcrExtractedData`, the DI prebuilt invoice model); the mock invents them.
- One row, one proof: a row justified by two documents is the exception the suggestions already cover (a second *Link*), not the panel's path.
- D58's derivation on read (F113 PR C) stays planned for links made without the panel; the panel writes the facts because the owner's click is the typing.

## Out of scope

- The proofs mailbox and the phone share target (F103 — the owner: not yet); AI proposals (F98); the closing run (F99); the subscriptions fold (F104, after 2026-11-30); splitting a row across two entities (one BAS per row, F113).
