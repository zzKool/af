# F93 — Global search: tasks

LIGHT lane (D45, D56). Spec: `spec.md`. Branch `feat/search-palette`. State as of 2026-10-26.

- [x] T001 `kernel/search`: `SearchHit` / `SearchGroup`, `parseSearchQuery` + `parseAmount` (the formats), `rankOf`, `toGroup`, `orderGroups` — pure tests
- [x] T002 `kernel/test-utils/search-fixtures.ts`: one of each entity per tenant, same keys in two tenants
- [x] T003 partners `searchPartnerHits` + test
- [x] T004 invoices `searchInvoiceHits` + test (drafts by period / amount; client names batched)
- [x] T005 supplier-invoices `searchSupplierInvoiceHits` + test (key, supplier's number, total / paid)
- [x] T006 expenses `searchExpenseHits` · `searchSettlementHits` + test
- [x] T007 documents `searchDocumentHits` + test (no relationship documents for the accountant)
- [x] T008 banking `searchBankTransactionHits` + test (texts, amount either sign)
- [x] T009 `app/(app)/search.ts` + `search.actions.ts` (the composition root), layout → AppShell → Topbar
- [x] T010 `kernel/ui/shell/search-palette.tsx` (Ctrl K / ⌘ K / Ctrl P, combobox + grouped listbox, debounce, newest answer wins) + client test
- [x] T011 en / fr / sv `shell.search.*`
- [x] T012 `scripts/seed-volume.ts` + `scripts/measure-search.ts`; measured → no trigram index
- [x] T013 e2e `search.spec.ts` (own invoice → Ctrl K → key → Enter); screenshots in `screenshots/`
- [x] T014 `docs/search.md` (indexed), F93 row, D56, ui-conventions + af-design shell line, lessons

Later (other lanes): the lists' `?q=` reading amounts (lessons F93); contracts, journal entries, trips as kinds.
