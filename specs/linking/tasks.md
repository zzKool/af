# Tasks: Linking — suggestions and the inbox

**Input**: `specs/linking/spec.md` · harvest `specs/banking/harvest.md` (H3, §4.1, §8.1), `specs/documents/harvest.md` (H7) · fixture `specs/banking/fixtures/matching-cases.json`

## Part 1 — `feat/linking-suggestions`

- [x] T001 `Linkable.facts` / `candidates` / `search` on the contract; `EntityFacts`, `CandidateQuery`, `Suggestion`, `BulkApplyResult` types; the linkables of banking (the row with the journal base, every text field, the entry's partner), invoices (issued / sent, direction by type), supplier invoices, expenses (company-paid awaiting their row, ± 10 days), documents (OCR total, vendor, unlinked and became nothing).
- [x] T002 Pure `scoring.ts` (`scoreMatch`, `rank`, `confidenceOf`, `partialTokens`, `daysBetween`) with the weights of harvest §8.1 and the v3 tightening (HIGH needs more than a name next to an approximate amount); `scoring.pure.test.ts` on `matching-cases.json` with the deviations written out, the cross-currency and partial-payment cases, the 200-run property (SC-001, SC-002).
- [x] T003 `suggestions.ts`: `suggestionsForTransaction`, `suggestionsForEntity`, `searchLinkables`, `applySuggestion` (min of both remainings; a document without an amount links without one; cross-currency refused here), `bulkApplyHigh` with the skip reasons and the ambiguity gap; `linksWithLabels`; actions (reads for the accountant, writes for the owner); `suggestions.test.ts` on imported Nordea rows.
- [x] T004 UI: `SuggestionsSection` (row or entity mode, chips, reasons in the user's language, allocation input, *Link*, *Link to…* search) and `LinksList` (*Unlink*); on the banking panel; `InvoiceLinks` on the invoice page; strings `linking.*` en + fr; `invoice-remaining` test id.
- [x] T005 `e2e/linking.spec.ts` (issued invoice → payment imported → HIGH suggestion → *Link* → paid → *Unlink* → open; SC-003), screenshots `specs/linking/screenshots/`, docs (`linking`, `banking`, `invoices`, index, inventory §3.13), PR.

## Part 2 — `feat/linking-inbox`

- [x] T006 `/banking/inbox` work page: the rows needing attention sorted by confidence then date, the detail on the right, `j` / `k` / `Enter` / `1`–`9` / `l` / `c` / `u` / `?`, the bulk bar with *Apply HIGH* and its applied / skipped report.
- [x] T007 Unlinked documents view (financial documents that became nothing and justify nothing), nav, e2e, screenshots, docs.

## Part 3 — `feat/linking-graph`

- [x] T008 `graph.ts` (`neighbourhood`, caps, `nodeKey`), `Graph*` types, `graphAction`, `hrefs.ts` (`graphHref`, `entityHref`); `graph.test.ts` (SC-004).
- [x] T009 `graph-layout.ts` (pure radial layout) + `graph-layout.pure.test.ts`; `LinkGraph` (picture + ring list), `GraphLink`; the page `/links/[type]/[id]`; the button next to every *Links* heading; `?open=<id>` on the three lists; strings `linking.graph.*` en + fr.
- [x] T010 e2e (the invoice's graph, *Open* lands on the banking panel), screenshots, docs (`linking`, inventory §3.13), PR.

## Part 4 — read API and the D40 kit (lane 8, 2026-10-23)

- [x] T011 `allocatedSums(tx, type, ids)` in `queries.ts` (exported with `ALLOCATING_KINDS` through `index.ts`): Σ allocations onto each target, whatever the source, allocating kinds only, one grouped query; `linking.test.ts` on bank-row and journal-entry allocations, checked against `getAllocationStatus` (lessons audit 22). The callers move in their own modules (supplier invoices' `allocated.ts` next round, T010 there).
- [x] T012 F71 — the graph page and the inbox adopt the D40 kit: `confidence-family.ts` + `ConfidenceLabel` (also on every `SuggestionsSection`), `moneyText` on `formatMoney`, `label-key.ts` + `EntityLabel` (`<CodeChip>` keys), type `<Tag>`s, the graph's ring rows with `RowActionsMenu`, the graph's node colours on `--chart-*` tokens, its title row with one primary, the inbox's underline tabs, uncoloured signed amounts, the document's *About* `DetailsSection`; `e2e/linking.spec.ts` reads the node's amount from `data-amount`; screenshots refreshed. No dictionary change.

## Part 5 — cleanup round (lane 1, DIRECT, behaviour-neutral, 2026-10-23)

- [x] T013 `hasLinks(tx, endpoint, kind)` in `queries.ts` (through `index.ts`): the existence check the modules' guards make with `tx.link.count` today (lessons audit 22); `linking.test.ts`. The callers move in their own modules.
- [x] T014 The ISO-day helpers from the kernel (lessons audit 27, linking's adoption line): `suggestions.ts` / `inbox.ts` `shiftDate` → `addDays`, `scoring.ts` `daysBetween` → `@/kernel/clock/calendar`'s (re-exported, `index.ts` keeps the name).
- [x] T015 `scoring.pure.test.ts`'s property states the confidence rule itself instead of calling `confidenceOf` (lessons audit 31).
- [x] T016 The inbox asks banking for main-account rows only, then pages (lessons audit 32: 300 rows paged first, then filtered — savings rows could crowd main ones out).
