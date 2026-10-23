# Tasks: Banking import + journal

**Input**: `specs/banking/spec.md`, `specs/journal/spec.md`, `plan.md` · two PRs

## Part 1 — `feat/banking-import` (model, parser, services, linkables, queries, tests, docs)

### Phase 1: Foundational
- [x] T001 `prisma/schema/banking.prisma`: `BankAccountRole` enum + `role`; `BankImport`, `BankTransaction`, `CategorisationRule` (+ enums `RuleMatchType`, `RuleMatchField`, `RuleSource`); `prisma/schema/journal.prisma`: `JournalEntry` (+ `JournalSource`, `JournalCategorisedBy`); tenant relations
- [x] T002 Migration `add_banking_import_and_journal`: enums, tables, CHECKs, unique indexes (partial one declared `@@unique(map:)`), RLS + grants, triggers (`bank_transactions_immutable`, `journal_entries_lock_money`, `block_delete_when_linked` × 2), Nordea format `Date` alias (UPDATE of `column_mapping`), `bank_accounts.role`
- [x] T003 `banking/types.ts`, `journal/types.ts`: DTOs (`BankTransactionDto`, `BankImportDto`, `ImportSummary`, `CategorisationRuleDto`, `TransferProposal`, `TransactionState`, `TransactionListRow`; `JournalEntryDto`, `JournalListRow`, `RateSource`, `CategorisedBy`); `can.ts` unchanged (`bank_transaction`, `journal_entry` exist)

### Phase 2: US1 — parser and import (P1)
- [x] T004 `csv-parser.ts` edits (D25): header validation with aliases, space thousands separator, raw columns by field, hash over raw columns, `occurrence`, `counterparty.ts`; `csv-parser.test.ts` + `counterparty.pure.test.ts` (July sample, bank-fee duplicate rows, swedish headers rejected, `-1 500,00`)
- [x] T005 `dedup.pure.test.ts`: property — re-import = 0 new, superset = exactly the extra rows, identical rows kept (over the pure `planImport(existingKeys, rows)` helper)
- [x] T006 `account-detect.ts` + test (Plusgiro / Sparkonto filenames, currency from first row, unknown → null)
- [x] T007 `journal/journal.ts`: schemas, `baseAmount`, `createBankEntries` (rateToBase; refuse when missing), `createManualEntry`, `categorise` (never-overwrite rules), `setBankImplicitRate`, `deleteBySource`, `deleteManualEntry`; `journal/queries.ts` `entriesForSources`, `getJournalEntry`; `journal/linkable.ts`; `journal/index.ts`, `ui.ts`; `base.pure.test.ts`
- [x] T008 `documents.storeGeneratedDocument`: CSV mime + `documentType`/`prefixType` for bank statements; review page / delete guard already treat `generated` as read-only
- [x] T009 `banking/import.ts`: `importCsv` (account, currency check, dedup, insert, document, journal entries, rules, record, audit), `deleteImport` (links check → cascade → journal.deleteBySource), `ensureDefaultRules`
- [x] T010 `import.test.ts` (DB): US1 scenarios 1–7, 9 on the fixtures; direct SQL update of `amount` refused; RLS

### Phase 3: US2 — rules (P1)
- [x] T011 `rules.ts`: schemas, pure `orderRules / matchRule / firstHit`, `createRule`, `updateRule`, `deleteRule`, `testRule`, `applyRules({dryRun})`, `applyToEntries`, `createRuleFromTransaction`; `rules.pure.test.ts` on `fixtures/categorisation-rules-sample.json#testPatternCases` + ordering + invalid regex
- [x] T012 `rules.test.ts` (DB): US2 scenarios 1, 3–8; counters; never touches manual entries

### Phase 4: US3 — transfer pairs (P2)
- [x] T013 `transfer-pairs.ts`: pure `transferCandidates` (window, signs, own accounts, rate 1 / 5 % of ECB, hints, confidence, reason params) + `transfer-pairs.pure.test.ts`; `proposeTransfers`, `acceptTransfer` (link + flags + implicit rate; refuse when paired); DB tests on the fixture pair and the savings move

### Phase 5: US4 / US5 — linkables, derived state, list queries (P2)
- [x] T014 `banking/linkable.ts`; `linking/linkables.ts` registers `bankTransactionLinkable` and `journalEntryLinkable`; `linking/linking.ts` source-side allocation check + `allocation.pure.test.ts` two-sided case + `linking.test.ts` case
- [x] T015 (`queries.test.ts` folded into `import.test.ts` / `journal.test.ts`) `banking/queries.ts`: `TRANSACTION_COLUMNS`, `listTransactions`, `distinctTransactionValues`, `transactionDateHierarchy`, `getTransaction`, `listImports`, `listRules`, `accountBalances`; `journal/queries.ts`: `JOURNAL_COLUMNS`, `listJournalEntries`, `distinctJournalValues`, `journalDateHierarchy`; `queries.test.ts` (state derivation, Excel semantics, sums)
- [x] T016 Actions (`import.actions.ts`, `rules.actions.ts`, `transfer-pairs.actions.ts`, `journal.actions.ts`) on `ownerAction` / `authedAction + can()`; `index.ts` / `ui.ts` surfaces; architecture guard green
- [x] T017 Seed: three accounts with roles, the two default rules; `test-fixtures.ts` TRUNCATE list
- [x] T018 Docs: `docs/banking.md`, `docs/journal.md`, `docs/linking.md` (source-side invariant, new linkables), `docs/feature-folders.md`, `docs/index.md`, inventory §3.10 / §3.12 status lines (the `banking.*` / `journal.*` dictionary keys come with the pages in part 2 — services return English messages with `details`)

## Part 2 — `feat/banking-pages` (pages, dialogs, e2e, screenshots)
- [x] T019 `banking/components/transaction-table.tsx` (DataTable, state chips, money in row currency, footer sums, account filter labelled by alias, category labelled `657 · Bankkostnader`), `transaction-panel.tsx` (raw columns, categorise form, links, transfer proposal + accept, *Create rule from this*), `import-dialog.tsx` (file → detected account → confirm → summary)
- [x] T020 `banking/components/imports-table.tsx` + delete; `rules-table.tsx` + `rule-dialog.tsx` (create / edit, regex behind *advanced*, *Test* count) + *Apply rules* (dry run → apply)
- [x] T021 `journal/components/categorise-form.tsx` (shared), `journal-table.tsx`, `manual-entry-dialog.tsx`
- [x] T022 Pages `/banking`, `/banking/imports`, `/banking/rules`, `/journal`; nav entries (owner + accountant); `nav-filter.test.ts`, `e2e/auth.spec.ts` updated
- [x] T023 `e2e/banking.spec.ts`: import the July sample → rows + fee rule applied → categorise one → create rule from it → import the CHF pair file → accept the transfer → journal shows the base; `e2e/screenshots.spec.ts` + screenshots in `specs/banking/screenshots/`
- [x] T024 Docs pages sections; definition-of-done checklist in the PR

## Dependencies

T001–T003 → T004–T010 (T007 before T009) → T011–T012 → T013 → T014–T018 → part 2.

## F65 — `feat/banking-account-lock-transfer-facts` (audit 20, D44)
- [x] T025 `bank-accounts.ts`: `updateBankAccount` refuses a number / currency change once the account has an import; `getBankAccounts` returns `imports`; `bank-accounts-tab.tsx` disables the two fields
- [x] T026 `transfer-pairs.ts`: `acceptTransfer` writes the link + the bank implicit rate only; `queries.ts` `deriveTransactionState` → `no_document` for a transfer leg
- [x] T027 `import.test.ts`: US3 scenarios rewritten (no flag typed; pair → unpair leaves facts and states as before), a rule applies to an accepted leg, an imported account's currency / number refused
- [x] T028 Docs: `banking.md`, `bank-accounts.md`, spec US3 / FR-010 / FR-011 / FR-017 / SC-004, D44, F65 row, lesson 20

## F69 — `feat/banking-months-panel` (lane LIGHT: a new screen, no rule change)
- [x] T029 The *Months* panel on `/banking` and its banner: read model `months.ts` (`bankMonths` — bank rows, their journal flag, the links through `linking.linksTouching`, the imports' periods, `package.builtPeriods`; the state through `deriveTransactionState`, nothing stored), `components/months-panel.tsx` (bars justified / to justify, account × month squares proven / open / not imported, a click on a bar = the Month filter), the `InfoBanner` *Transactions without proof: N — package YYYY-MM not built*; `banking.months.*` / `banking.banner.*` en + fr + sv; tests `months.pure.test.ts`, `months.test.ts` (a transfer-pair month, a not-imported month, an unbuilt → built package), `e2e/banking.spec.ts` step 5; docs `banking.md`, F69 row

## F71 — `feat/banking-d40-kit` (lane LIGHT: the D40 kit, no rule change)
- [x] T030 Banking adopts the D40 kit: `state-family.ts` (the one state → family map) + `TransactionStateLabel`; on-screen money through `formatMoney` (table, panel, balances, transfer banner); the counterparty key a `<CodeChip>`, the account and the rule source `<Tag>`s, the currency pill in Settings → Bank accounts a `<Tag>`; no Tailwind palette colours left; the title rows' actions (`header-actions.tsx`: one primary each — *Import CSV*, *New rule*); the panel as `DetailsSection`s (About · Proof · Journal entry; *History* waits for its i18n key — F74); Date and Account quick filters, the balances as the filter bar's context; the imports and rules pages on the DataTable (in-memory `IMPORT_COLUMNS` / `RULE_COLUMNS`) with ⋮ `rowActions`. Tests `state-family.pure.test.ts`; `e2e/banking.spec.ts` on the D40 amount and DataTable rows; screenshots light + dark; docs `banking.md`, F71 row

## F71 — `feat/banking-history` (lane LIGHT: a new panel section, no rule change)
- [x] T031 The panel's *History* section: `history.ts` (`transactionHistory` — the row's, its journal entry's and its live links' audit trails through `kernel/audit` `getAuditLog`; `toHistoryEvents` pure, newest first; nothing stored), `getTransactionHistoryAction` (read, `can(read, bank_transaction)`), `components/transaction-history.tsx` (collapsed `DetailsSection` titled `details.history`, reloaded after each save in the panel); `banking.history.*` en + fr + sv; tests `history.pure.test.ts`, `reads.test.ts`, `e2e/banking.spec.ts` step 3; screenshots `f71-history-light/dark.png`; docs `banking.md`. Removed links not shown (lessons)

## Lessons audit 23 — `feat/banking-history` (lane DIRECT: read API, no caller moved)
- [x] T032 `queries.ts` read API: `outgoingMainRows(tx, limit)` (+ `OutgoingMainRow`), `bookingDates(tx, ids)`, `firstBookingDate(tx)`, exported through `index.ts`; tests in `reads.test.ts`. The callers in expenses / supplier-invoices / package move in their own lanes (lessons 23)

## Lane 2 — cleanup round (lane DIRECT, behaviour-neutral; lessons audit 22, 23, 27, 29, 30, 32)
- [x] T033 `transactionStates(tx, ids)` (+ `TransactionStateFacts`) in the read API — state, Σ allocated, transfer leg; for `package/collect.ts` (lessons 23; the caller moves in package's lane). Tests in `reads.test.ts`, `import.test.ts`
- [ ] T034 banking's `tx.link` reads → linking (`allocatedFrom`, `linksTouching` with `kinds`, `hasLinks` / `linksTouching`): `queries.ts` `linkFacts`, `transfer-pairs.ts` `pairedIds`, `import.ts` `deleteImport`; the allocation sum takes linking's kind filter — totals proven unchanged on the seed (lessons 22)
- [ ] T035 kernel helpers: `isSettled` in `deriveTransactionState`, `daysBetween` / `addDays` in `transfer-pairs.ts` (lessons 27)
- [x] T036 `columnMapping` parsed on read: `parseColumnMapping` (`csv-parser.ts`, a zod schema of the stored structure) behind `formatConfig`, which returns null when it does not fit — `importCsv` refuses with a message instead of failing inside the parser; the settings test reads the seeded mapping without a cast (lessons 29)
- [ ] T037 the local `ServiceResult` and Decimal look-alike in `linkable.ts`; `getBankFormats` → a DTO (lessons 30)
- [x] T038 `statementKey` → `numbering.bankStatementKey` (the one slug helper behind `fileSlug` and it — same keys, hyphens for the statement); the bank text join once (`bankText` in `rules.ts`, read by the rule field `all` and both transfer-pair legs — blank fields skipped everywhere); a rule's `hitCount` / `lastHitAt` count only the hits that changed the entry (`changedBy`, before / after facts) (lessons 32)
