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

- [x] T013 `/expenses` — `ListPage` + `ExpenseTable` (DataTable on `EXPENSE_COLUMNS`, KPI strip from `ledgerSnapshot`), side panel (`ExpensePanel`: facts form saved on change, document, links, attach bank row for company-paid), *New expense* dialog (group select / create inline, category, paid by, amount, currency, date, document picker from the inbox or upload, document missing), delete.
- [x] T014 `/expenses/groups/[id]` — header, totals, the group's expenses, *add expense*, the trip panel (`TripPanel`: date-times, country, agency, meal steppers, collapsed nights / long stay, result card, *Create per-diem expense* / *Recompute*).
- [x] T015 `/expenses/settle` — open private expenses (FIFO order, checkboxes, editable allocations, totals) · transaction picker · confirm dialog (exact / partial / over-allocated, exchange-difference line, rounding note) · settlements list below with cancel; `/expenses/settlements/[id]` detail with the statement download.
- [x] T016 `src/app/print/settlement/[id]/page.tsx` + `StatementSheet` (print mode; invoice-pdf skill), screenshot of the PDF.
- [x] T017 Settings → *Traktamente rates* tab (`RateTable`: year tabs, inline edit, copy last year, paste Skatteverket CSV with preview).
- [x] T018 Nav (*Expenses* for owner + accountant), strings `expenses.*` / `traktamente.*` en + fr, `e2e/expenses.spec.ts` (group → three expenses from the fixture (SEK, CI has no ECB) → settle → statement → trip → per-diem), `e2e/screenshots.spec.ts` additions, `specs/expenses/screenshots/`, docs pages sections, PR.

## F62 — one owed / one open rule (`feat/expenses-owed-open`, lane DIRECT, lessons audit 13–17)

- [x] T019 `owedBase()` in `status.ts` + `allocatedByExpense` in `settlements.ts`; the list, the groups, the ledger, `openPrivateExpenses`, the status and the statement read them (test: a 0.30 residual, list sum = ledger = 0.00).
- [x] T020 One `isOpen` (settlement line or `justifies` onto it, D37) for update / delete / per-diem replace and the panel (`ExpenseDetail.isOpen`); migration `20261023120000_expenses_lock_when_paid` — the trigger tests the same facts (test: a paid expense refused by the DB, reopened by detach).
- [x] T021 Settle screen on `settlementDifference` + `owedBase` in Decimal; the statement in `fifoOrder`.
- [x] T022 `statement_superseded` derived (`isStatementSuperseded`); the column unread / unwritten (test: a statement stored after the cancel reads superseded).
- [x] T023 Traktamente: a failed computation clears `trips.computed`; `parsePerDiemResult` (Zod) on read (test).
- [x] T024 Drop `settlements.statement_superseded` — the owner's OK 2026-10-23 (D48); F86's migration `20261023200000_drop_unread_columns`, with journal T010.

## F71 — the D40 kit (`feat/expenses-d40-kit`, lane LIGHT)

- [x] T025 States → `<StateLabel>` through one map (`state-family.ts`, `ExpenseStateLabel` / `SettlementStateLabel`; `StatusBadge` gone); on-screen money → `formatMoney` (list, KPIs, panel, groups, group meta, settle page, settlements; the statement sheet keeps `formatCurrency`); keys → `<CodeChip>`; kind / payer / group kind / link kind → `<Tag>`; no palette colour; one primary per title row (`header-actions.tsx`); groups and settlements ⋮ `RowActionsMenu`; the panel in `DetailsSection`s About · Proof · Money · Facts · History (`history.ts` from the audit trail); quick filters Date + Paid by; no Σ of the mixed-currency amount; the SEK base column hidden by default (the row fits the canvas). Tests `state-family.pure.test.ts`, `history.pure.test.ts`, DB sums + history; `e2e/expenses.spec.ts` on the D40 amount and the settlement link; screenshots light + dark.

## Cleanup round — lane 3 (lane DIRECT, behaviour-neutral except F88)

- [x] T026 F88 (D47): the statement prints *owed* — `resolveStatement` on `owedBase`; test: the 0.30 residual's statement prints 0.00, residual = ledger.
- [x] T027 Read API for the other modules (lessons audit 23, 25): `activeSettlementTransactionIds(among?)` (supplier invoices' picker, instead of `tx.settlement`); `getGroup(id)` was already exported through `queries.ts`.
- [x] T028 Reads through the owners' read API (lessons audit 22, 23 follow-up, 25): `settleableTransactions` → `banking.outgoingMainRows` minus `activeSettlementTransactionIds`; the detail's booking dates → `banking.bookingDates`; the statement job → `banking.getBankTransaction`; every `tx.link` read → `linking.linksTouching` / `createdFromTargets`; the panel's links → `linking.linksWithLabels`; its receipt → `documents.getDocument`. No `tx.link` / `tx.bankTransaction` / `tx.document` left in the module.

## Dependencies

T001 → T002/T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → (merge) → T013–T018.
