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
