# Tasks: Expenses + traktamente

**Input**: `specs/expenses/spec.md`, `specs/traktamente/spec.md`, `specs/expenses/plan.md` · fixtures `specs/expenses/fixtures/owner-flow-settlement.json`, `specs/traktamente/fixtures/*`

## Part 1 — `feat/expenses-core` (model, services, calculator, job, linkables, queries, tests, docs)

### Phase 1: Foundational

- [x] T001 Schema `prisma/schema/expenses.prisma` (groups, payment sources, expenses, settlements, lines) + `prisma/schema/traktamente.prisma` (normalbelopp, trips) + tenant relations; migration `20261021120000_add_expenses_and_traktamente` (enums, tables, CHECKs, partial unique indexes, triggers `expenses_lock_when_settled`, `settlements_lock`, delete guards, RLS, grants); `prisma generate`; drift check green.
- [x] T002 Numbering: `expenseSeries(group, alias)` → `exg-213-Tr` (replaces `expenseGroupSeries`), `settlementSeries(date)` → `ST26`, `settlementNumber(date, seq)` → `ST26-001`, `statementPdfKey(number, bookingDate)` → `Reimb_ST26-001_2026-03-31.pdf`; tests; `docs/numbering.md`.
- [x] T003 `settings.basAlias` / `basAliases` (tenant short code ?? suggested alias); `documents.assignBusinessKey` (uploaded or extracted documents only, audited); `kernel/db/test-fixtures.ts` TRUNCATE list.

### Phase 2: US1 + US2 — groups, sources, expenses (P1)

- [x] T004 `types.ts` (DTOs, enums, `RATE_SOURCES`), `groups.ts`, `payment-sources.ts` (+ `ensureDefaultSources`), `expenses.ts` (`createExpense` from a document or not, `updateExpense`, `deleteExpense`, `attachBankTransaction`, `detachBankTransaction`, `createPerDiemExpense`, `replacePerDiemExpense`), `status.ts` (pure `deriveExpenseStatus`).
- [x] T005 `expenses.test.ts` (DB): fixture keys / bases, alias snapshot, ECB daily / nearest / SEK / missing rate, company-paid provisional → attached (bank base, `justifies` link, paid amount), document key + `created_from`, money lock once settled (trigger by SQL + service), delete guards, group delete guard, 20 concurrent creations one series, RLS; `status.pure.test.ts`.

### Phase 3: US3 + US4 — ledger, settlements, statement (P1)

- [x] T006 `fifo.ts` (pure `fifoAllocate`, `settlementDifference` with the 0.50 tolerance and the rounding note) + `fifo.pure.test.ts` (variant A proposal, B, C, 200-run property SC-002).
- [x] T007 `settlements.ts` (`proposeSettlement`, `confirmSettlement`, `cancelSettlement`), `statement.ts` (`resolveStatement`), `jobs/render-statement.ts` (`expenses.render-statement`), `instrumentation.ts` registration.
- [x] T008 `settlements.test.ts` (DB): variants A / B / C end to end on real bank rows (CSV import of a fixture refund), refusals (US4-5), cancel reopens, job idempotence with a stubbed renderer (`kernel/pdf` mocked), ledger snapshot.

### Phase 4: Traktamente (P1 / P2)

- [x] T009 `traktamente/calculator.ts` (pure `countDays(departure, return, zone)`, `computePerDiem`), `calculator.pure.test.ts` (every `day-count-cases.json` case on the v3 column, worked examples of `meal-reductions.json`, the SE triple rule, two rate years, property SC-002).
- [x] T010 `rates.ts` (`upsertRate`, `deleteRate` guarded by trips, `copyRatesFromYear`, pure `parseSkatteverketCsv`, `pasteSkatteverketCsv`), `trip.ts` (`upsertTrip`, `previewPerDiem`, `createOrReplacePerDiemExpense` through expenses), `queries.ts`; `rates.test.ts`, `trip.test.ts` (DB).

### Phase 5: Surface, queries, docs

- [x] T011 `expenses/queries.ts` (`EXPENSE_COLUMNS`, list / distinct / hierarchy, `getExpense`, groups with totals, settlements, `ledgerSnapshot`, `openPrivateExpenses`, `settleableTransactions`), `linkable.ts` (+ registration in `linking/linkables.ts`), `expenses.actions.ts`, `traktamente.actions.ts`, `index.ts` / `ui.ts` of both; list tests in `expenses.test.ts`; architecture guard green.
- [x] T012 Seed: four payment sources, the 2025 normalbelopp subset (`v1-seed`); `docs/expenses.md`, `docs/traktamente.md`, `docs/index.md`, `docs/feature-folders.md`, `docs/feature-inventory.md` (§3.7 / §3.8 status), `docs/linking.md` (new linkables); lint / typecheck / unit green; PR.

## Part 2 — `feat/expenses-pages` (pages, dialogs, e2e, screenshots)

- [ ] T013 `/expenses` — `ListPage` + `ExpenseTable` (DataTable on `EXPENSE_COLUMNS`, KPI strip from `ledgerSnapshot`), side panel (`ExpensePanel`: facts form saved on change, document, links, attach bank row for company-paid), *New expense* dialog (group select / create inline, category, paid by, amount, currency, date, document picker from the inbox or upload, document missing), delete.
- [ ] T014 `/expenses/groups/[id]` — header, totals, the group's expenses, *add expense*, the trip panel (`TripPanel`: date-times, country, agency, meal steppers, collapsed nights / long stay, result card, *Create per-diem expense* / *Recompute*).
- [ ] T015 `/expenses/settle` — open private expenses (FIFO order, checkboxes, editable allocations, totals) · transaction picker · confirm dialog (exact / partial / over-allocated, exchange-difference line, rounding note) · settlements list below with cancel; `/expenses/settlements/[id]` detail with the statement download.
- [ ] T016 `src/app/print/settlement/[id]/page.tsx` + `StatementSheet` (print mode; invoice-pdf skill), screenshot of the PDF.
- [ ] T017 Settings → *Traktamente rates* tab (`RateTable`: year tabs, inline edit, copy last year, paste Skatteverket CSV with preview).
- [ ] T018 Nav (*Expenses* for owner + accountant), strings `expenses.*` / `traktamente.*` en + fr, `e2e/expenses.spec.ts` (group → three expenses from the fixture (SEK, CI has no ECB) → settle → statement → trip → per-diem), `e2e/screenshots.spec.ts` additions, `specs/expenses/screenshots/`, docs pages sections, PR.

## Dependencies

T001 → T002/T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → (merge) → T013–T018.
