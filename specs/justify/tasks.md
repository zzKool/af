# Tasks — Justify from the bank row (F97)

Spec: `spec.md`. The lane: spec (approved by the owner's *go*, 2026-10-27) → build, one PR per story group.

## PR 1 — `feat/linking-justify` (US1, US3; 2026-10-27)
- [x] T001 `linking/justify-rules.ts` (pure, client-safe): `compareRowToReading`, `proposeKind`, `isCardPurchase`, `monthOf`, `NO_PROOF_REASONS` / `NO_PROOF_BAS`; `justify.pure.test.ts`
- [x] T002 `linking/justify.ts`: `justifySchema` (its own fields — the modules' schemas are not imported, the load cycle), `justifyRow` (the entity through the owning module with the document or `document_missing`, the payment through the module's own path by currency, `banking.categorise` by hand; a refused step named; refused before any write for a savings / incoming / justified row), `noProofNeeded` (the flag + the reason's account, `proposeRule` when no active rule hits); `justify.test.ts` (DB)
- [x] T003 `justifyRowAction`, `noProofNeededAction` (owner); `justifyOptions(tx, caller)` for the pages (groups, expense categories, active sources, partners)
- [x] T004 `components/justify-panel.tsx`: the drop zone (upload → poll the review read → the card), the kind toggle, the reasons, *Receipt lost*; `CompareCardForm` (the two sides, the verdict, the partner match card, the fields, the one button, *Fix the reading →*); rendered by `TransactionDetailView` above *As the bank said* for an open / partial outgoing row when the page handed `justifyOptions`; the inbox's `p` · `n` · `x` keys and help
- [x] T005 i18n `linking.justify.*`, `linking.inbox.help.proof / noProof / lost` (en, D62); docs `linking.md` (the section, the surface, the tests), `banking.md` (the panel), features F97 partial, the spec's status
- [x] T006 e2e `justify.spec.ts` (three rows from the inbox under the mock OCR); screenshots `specs/justify/screenshots/` (the panel, the card, the lost card)

## PR 2 — `feat/linking-payment-picker` (US2)
- [x] T007 `PaymentPicker` (`components/payment-picker.tsx`): the entity's scored rows (`suggestionsForEntityAction`, confidence, reasons, *Pick*) + a search (`searchRows`, pure: a date prefix, an amount ± 1 %, the text) over the rows the host loaded — a selection component, the payment stays the host's action; replaces the `<Select>` in `supplier-invoice-panel-payments.tsx` and `expense-panel-payments.tsx` (`payableTransactions` / the payer's rows are the search pool); `payment-picker.pure.test.ts`; the supplier-invoices e2e links through it (screenshot `payment-picker.png`)
- [x] T008 A HIGH inbox document on the row's panel: *A proof already in the inbox matches this row* → *Use it* — the card on an existing document (the upload step skipped). Built 2026-10-29 (`feat/linking-justify-ux`, F124 (2)) with: *Create as* labelled + hint, the category / supplier pre-filled from a HIGH proposal (F98), *Still needed: …* on the greyed button, the compare table, `proposeKind` card-purchase-first (spec US1 scenario 5), *New supplier* wording

## PR 3 — `feat/nav-work` (US4, the nav file alone)
- [ ] T009 `/banking/inbox` labelled *Work*, first, with the one count (rows to justify + documents to review); `nav.*` keys; the nav tests and `e2e/auth.spec.ts`

## PR 4 — US5
- [x] T010 `updateDocumentCorrections` refuses a document with a `created_from` link (`BUSINESS_RULE_VIOLATION`, *became an expense — edit it there*, through `linking.createdFromTargets`); the review client renders the form read-only under the banner *This document became {key} — its facts are read here and edited there* with *Edit on the entity →*; `documents.test.ts`, the document-review e2e asserts the banner and a disabled field; `docs/document-review.md`
