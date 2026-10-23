# Banking — Nordea import, transactions, categorisation rules, transfer pairs

Module `src/modules/banking` · schema `prisma/schema/banking.prisma` · migration `20261021100000_add_banking_import_and_journal` · spec `specs/banking/` (harvest, spec, plan, tasks) · decisions D3, D13, D18, D25, D31. Part 1: model, parser edits, import, rules, transfer pairs, linkables, queries. Part 2: the workbench, the imports and rules pages (the journal page in [[journal]]).

> A bank transaction is one CSV row, kept verbatim and never updated. The owner's facts about it — BAS category, partner, note, *no document needed* — live on its [[journal]] entry. *Open / partially linked / linked / no document needed* are **derived** from the links and the journal flag. Rules set facts, never a status; transfer pairs are `transfer` links — and only links: accepting one writes nothing on the legs' entries (F65).

## Model

```
bank_accounts         (v2) + role ∈ main | savings — the savings CSV goes to the accountant yearly (D13/D31), nothing else
bank_imports          account · file_name · document_id (the stored CSV, validated UUID) · record/imported/duplicate/error counts
                      errors [] · period_from / period_to (min/max booking date) · imported_at
bank_transactions     account · import · booking_date · amount (signed) · currency · balance? (end-of-day, last row of a day only)
                      sender · recipient · name · additional_details · message · own_notes   (the six raw columns, verbatim)
                      description · reference · counterparty_key · dedup_hash · occurrence · row_index
                      UNIQUE (account, dedup_hash, occurrence) · trigger bank_transactions_immutable (no UPDATE, no UPDATE grant)
                      trigger block_delete_when_linked('bank_transaction')
categorisation_rules  name (unique) · match_type ∈ contains|starts_with|ends_with|exact|regex · match_pattern
                      match_field ∈ counterparty_key (default)|name|details|message|sender|recipient|all
                      bas_code? · partner_id? · no_document_needed · priority 0–999 · is_active · rule_source ∈ manual|learned
                      hit_count · last_hit_at · CHECK (sets at least one of category / partner / flag)
```

Cross-module references (`document_id`, `partner_id`, the journal's `source_id` / `rule_id`) are validated UUIDs, never FKs. `bank_transactions.bank_account_id / bank_import_id` are intra-module FKs (RESTRICT / CASCADE).

## The parser — `csv-parser.ts` (v2, three D25 edits)

Buffer + format config → rows. (1) The header row is validated against the format's labels **or their aliases** (`Date` for `Booking date` — the owner's real exports say `Date`); anything else is *Not a Nordea export*. (2) A space thousands separator (`-1 500,00`) is accepted. (3) The dedup hash is `sha256(date | amount | currency | sender | recipient | name | additional details | message)` — never the row's position, the balance (end-of-day only) or the owner's notes (editable in Nordea); identical rows of one file get `occurrence` 0, 1, … Dates are checked as calendar dates; a bad row is reported (`Row 7: invalid amount "abc"`) and the others parsed.

Derived text: `description` = name → additional details → sender → recipient → *Unknown transaction*; `reference` = the `Message` column verbatim; `counterparty_key` (`counterparty.ts`, Excel *Column1*) = name, else the details without the card prefix (`Kortköp 260727 OPENAI *CHATGPT SUBS` → `OPENAI *CHATGPT SUBS`), else message / sender / recipient; upper-cased, trailing 4-digit card suffix dropped, whitespace collapsed.

`account-detect.ts`: the filename pre-selects the account (`PLUSGIROKONTO FTG 123 45 67-8 - …` → the number; the first row's currency picks between the SEK and CHF main accounts that share it). A hint for the dialog, never a creation.

## The import — `import.ts`

`importCsv(tx, caller, audit, storage, {bankAccountId, fileName, bytes})`, one transaction, nothing written before every check passed:

1. parse (header, rows, per-row errors) · 2. every row's currency = the account's, else *Currency CHF in file does not match account Plusgirokonto SEK (SEK)* · 3. dedup per account on `(hash, occurrence)` (`planImport`) · 4. a base rate exists for every new booking date (`journal.resolveRate`; *No exchange rate for 2026-07-08 — run the ECB sync*) · 5. the CSV stored as a document (`documents.storeGeneratedDocument`, `text/csv`, `bank_statement`, status `generated`, key `Bank_Plusgirokonto-SEK_2026-07-03_2026-07-28.csv` — even when every row was a duplicate: the package needs the file) · 6. the import record · 7. the transactions in file order (audited) · 8. one journal entry per transaction (`journal.createBankEntries`: SEK → rate 1 `same_currency`; CHF → ECB of the booking date, nearest weekday) · 9. the active rules on the new entries (the two defaults are created first when the tenant has none — `ensureDefaultRules`).

A failure after the first write is **thrown** as `RollbackError` (kernel/errors) so the transaction rolls back whole; the action client returns its `appError` like a returned error. (A returned `ServiceResult` error would commit the partial write — the middleware commits whatever the handler returns.)

`deleteImport`: refused when any of its transactions is linked (`links` count + the delete trigger); else the journal entries (`journal.deleteBySource`), the transactions and the record go, audited. `deleteBankAccount` refuses while imports exist.

## Rules — `rules.ts`

Pure: `orderRules` (active, priority desc → longer pattern → newest), `fieldText` (`all` = the five text columns joined), `matchRule` (case-insensitive; an invalid regex never matches, never throws), `firstHit`. Fixture `specs/banking/fixtures/categorisation-rules-sample.json#testPatternCases` runs in `rules.pure.test.ts`.

Service: `createRule` / `updateRule` / `deleteRule` (name pre-checked — a unique violation would abort the Postgres transaction; BAS code through `settings.getBasCategory`, partner through `partners.getPartner`, regex compiled on save), `testRule` (matches / tested over the newest 500 uncategorised rows), `applyRules({dryRun})` (every active rule over every uncategorised bank entry; dry run previews ≤ 50 and writes nothing), `applyToEntries` (the import's call), `createRuleFromTransaction` (pre-filled from the counterparty key and the entry's facts, `learned`, applied to that entry at once), `ensureDefaultRules` (`AVGIFTER NORDEA` → 657 no document; `^(R[äa]nta|Interest)\b` on the details → 831 no document).

A hit writes through `journal.categorise(…, {by: "rule", ruleId})`: category when the entry has none (a partner-only rule brings the partner's default category), partner when none, the flag OR-ed; an entry categorised **by hand is never touched**. Counters (`hit_count`, `last_hit_at`) move on real applies.

## Transfer pairs — `transfer-pairs.ts`

Pure `transferCandidates(a, others, ecbRate)`: another own account, opposite sign, ≤ 2 days apart; same currency → equal amounts (rate 1); else `implied = |SEK| ÷ |foreign|` within 5 % of the ECB rate of `a`'s date. Hints (`CHANGE`, `CHFSEK`, `ÖVERFÖRING`, the other account's number in the text) raise the confidence shown, never required. Constants, not settings.

`proposeTransfers(tx, id)` (empty once paired) · `acceptTransfer(tx, caller, audit, {fromId, toId})` → one `transfer` link debit → credit (through [[linking]]) and the foreign entry's `bank_implicit_rate = implied` (its `rate` / `amount_base` stay ECB, D3). **Nothing else is written on the legs** (F65, D44): no `no_document_needed`, no `categorised_by = manual` — so rules still categorise an accepted leg, and unpairing (removing the link) leaves both rows exactly as before. The state *no document needed* of a leg is derived from the link. The bank implicit rate is set once (database trigger) and stays after an unpairing. The owner's July pair: −20 000.00 CHF ↔ +237 740.00 SEK → 11.887 (fixtures `nordea-transfer-pair-*.csv`).

## Derived state and lists — `queries.ts`

`deriveTransactionState({amount, allocated, inTransfer, noDocumentNeeded})`: `no_document` when the flag is set **or the row is in a `transfer` link** (the other statement row is its proof — F65); `linked` when `Σ allocations ≥ |amount| − tolerance` (`settlementTolerance`, D25); `partial` when Σ > 0; else `open`. Never stored.

`TRANSACTION_COLUMNS` is the DataTable contract; the list runs in two steps (Prisma on the stored columns → the journal facts, Σ allocations from `links`, partner names and BAS labels joined over that set → derived filters, search, sort, page and sums in memory through `kernel/list-query/memory`, cap 20 000). `distinctTransactionValues` / `transactionDateHierarchy` keep Excel semantics. `getTransaction` returns the raw row, the entry, the state, the links with the other side's label and the transfer proposals. `listImports`, `listRulesWithLabels`, `accountBalances` (the balance of the latest booking date that has one — no stored running balance). Since F71 the imports and rules pages are DataTables too: `IMPORT_COLUMNS` / `RULE_COLUMNS` with `listImportsPage` / `listRulesPage`, `distinctImportValues` / `distinctRuleValues`, `importDateHierarchy` / `ruleDateHierarchy` — a handful of rows, so every column is evaluated in memory (`memoryTable`, the same `kernel/list-query/memory` semantics); `accountLabel` is an `enum` column (a checkbox filter of account names). `rawRowsForPeriod({from, to, by: "booking" | "import", role?})` — the raw rows of a period with their account, source file and the account's CSV conventions, booking date then file order: what the [[accountant-package]] writes as `bank-statements/*.csv`.

## The Months panel — `months.ts` (F69)

A read model, no table: `bankMonths(tx, {today})` → per month from the first month an import covers (at least twelve months back) to today's month:

```
bank rows of the window ─┐
journal flag (no doc)  ──┼─► deriveTransactionState ─► justified  = linked | no_document
links (linking index)  ──┘    (the workbench's rule)     to justify = open | partial
imports' period_from → period_to ─► per account × month: proven (imported, nothing to justify — rows or not)
                                                         open (≥ 1 row to justify) · not imported (no import covers it, no row)
package.builtPeriods(months) ─► banner = the newest closed month with bank rows whose monthly package is not built
```

- **Bars** — rows justified (`--state-done`) under rows to justify (`--state-attention`), scaled to the busiest month; a click on a bar sets the table's Month filter (`f.bookingDate=dates:2026-07`), a second click (or *All months*) clears it. The panel starts scrolled to today's month.
- **Squares** — one row per account (main and savings), the same states for that account only; the words are in each square's label and the legend.
- **Banner** — *Transactions without proof: N — package YYYY-MM not built. Open package* (`InfoBanner` in the page header). Never the running month; gone once that month's package is built (any version). Savings rows count by booking date here, though the package takes them by import (D31).
- Read from `package/index.ts` (`builtPeriods`) and `linking/index.ts` (`linksTouching`, `ALLOCATING_KINDS`) — banking reads no other module's table for it. The panel is hidden until the first bank row.

## Accounts — `bank-accounts.ts`

CRUD on Settings → Bank accounts ([[bank-accounts]]). Once a CSV is imported into an account its **number and currency are locked** (F65): `updateBankAccount` refuses a change of either with *This account has N import(s); its number and currency can no longer change* (`BUSINESS_RULE_VIOLATION`, `details.imports`) — they say which rows belong to it. Alias, IBAN / BIC, format and role still change. `getBankAccounts` returns `imports` (the count) and the settings tab disables the two fields when it is > 0. Delete is refused while imports exist.

## Linkable

`bankTransactionLinkable`: label `2026-07-08 · -20000.00 CHF · CHANGE CHFSEK`, amount `|amount|`, currency. The linking service now checks the **source side** of an allocation too: Σ allocations from one transaction (or manual journal entry) never exceed its amount, in its currency.

## Surface

- `index.ts`: parser, counterparty, account detection, import, rules, transfer pairs, queries, linkable, DTOs and constants.
- `ui.ts`: actions + types (components come with part 2).
- Actions (`banking.actions.ts`): reads on `authedAction` + `can(read, bank_transaction)` (the accountant reads); `importCsvAction` (FormData: file + account), `detectAccountAction`, `deleteImportAction`, rule CRUD / test / apply / from-transaction, `proposeTransfersAction`, `acceptTransferAction` on `ownerAction`.
- `modules/linking/linkables.ts` registers `bankTransactionLinkable` and `journalEntryLinkable`.

## Pages (part 2; the D40 kit since F71)

States go through **one** map, `state-family.ts` (`open` → attention, `partial` → in progress, `linked` → done, `no_document` → neutral), rendered by `TransactionStateLabel`; money on screen through `formatMoney`; no Tailwind palette colours, no pastel chips.


- `/banking` — `ListPage`, title row: *Inbox* · *Imports* · *Rules* · **Import CSV** (the one primary — `WorkbenchActions` in `header-actions.tsx`; the `ImportDialog`: file → the account pre-selected from the file name and the first row's currency (`detectAccountAction`) → summary with the period, the rules applied and *Show the new rows* = the list filtered on that import); banner: the Months banner above; the **Months panel** (F69, above); `TransactionTable` (DataTable on `TRANSACTION_COLUMNS`: the state as a `<StateLabel>`, the amount signed in the row's currency through `formatMoney` (positive in `--state-done`), footer sums of `amount` and `amountBase`, **Date** and **Account** as quick filters, category / partner / import filters labelled by name; the account balances on the right of the filter bar — a click = the Account filter on that account, again = off; the as-of date in its tooltip). A row opens the **docked details panel** (`TransactionPanel`): the title (date · amount · state) and the account as a `<Tag>`; the transfer proposal as an `InfoBanner` with *Accept as transfer*; then `DetailsSection`s — *As the bank said* (About: the Nordea columns, the balance, the counterparty key as a `<CodeChip>`, the source file), *Links* (Proof: the links with *Unlink* — `LinksList`, the graph link, the **suggestions** with *Link* / *Link to…* — `SuggestionsSection` from [[linking]], hidden once the row needs no document), *Journal entry* (the base and rate, `CategoriseForm` from the journal module — saved on change, the saved entry shown at once — and *Create rule from this*: the `RuleDialog` pre-filled from the counterparty key and the entry's facts, `learned`). No *History* section yet: its key `details.history` exists since F74; the section is banking's next PR. The panel's body is `TransactionDetailView`, shared with the inbox's right pane.
- `/banking/imports` — `ImportsTable` (DataTable): the file name is the row link (its rows on the workbench), account (quick filter), period, counts, imported at; ⋮ → *Delete* (confirm; refused while linked). Title row: **Import CSV**.
- `/banking/rules` — `RulesTable` (DataTable, the order the rules run in: priority, then name): the name opens the edit dialog (`RuleDialog`, regex behind *Advanced*, *Test* = matches over the newest uncategorised rows), source as a `<Tag>`, *Active* a column (was a faded row); ⋮ → *Edit* / *Delete*. Title row: *Apply rules* (dry run → a confirm dialog with the preview → *Apply now*) · **New rule** (`RulesActions`).
- Settings → Bank accounts gains the *Role* select (main / savings).
- Nav: *Banking* for owner and accountant (reads: the panel is read-only, no import / rules / accept). Strings `banking.*` en + fr + sv.
- Kernel kit additions for these pages: `components/ui/dialog.tsx` and `components/ui/sheet.tsx` (Base UI, same shape as `alert-dialog.tsx`); the DataTable now labels filter chips and footer sums by header even for hidden columns.

E2E `e2e/banking.spec.ts` (SEK only — CI has no ECB rates): the July sample → fee rule applied → categorise the OpenAI row by hand → *create rule from this* → the savings file (interest rule) and the SEK leg → accept the transfer pair → rules, journal and imports pages. Screenshots: `specs/banking/screenshots/` (import dialog, summary, rule dialog, transfer proposal / accepted, journal; since F71 the workbench, the panel, rules and imports light + dark).

## Tests

`csv-parser.test.ts` (v2 + D25: `Date` header, July sample, Swedish headers rejected, space thousands, calendar dates, hash independence) · `counterparty.pure.test.ts` · `account-detect.pure.test.ts` · `dedup.pure.test.ts` (fast-check: re-import = 0 new, superset = the extra rows, balance/notes outside the key) · `state-family.pure.test.ts` (F71: every derived state has a D40 family, and the attention / in-progress ones are exactly the Months panel's *to justify*) · `rules.pure.test.ts` (fixture cases, `all`, invalid regex, ordering) · `transfer-pairs.pure.test.ts` · `months.pure.test.ts` (month arithmetic, the cell rule, the banner's month, link facts) · `months.test.ts` (DB: a transfer-pair month before / after accepting, not-imported months and an import period without rows, the banner with a queued then a built package, the window, RLS) · `import.test.ts` (DB: US1 scenarios on the fixtures, immutability by SQL, delete with/without links, RLS; US3 the pair and the savings move, pair → unpair leaves the facts and states as before, a rule categorises an accepted leg; F65 an imported account's number / currency refused; US4/US5 state and the source-side invariant) · `rules.test.ts` (DB: defaults on first import, apply dry/real, partner default, manual never overwritten, learned rule, refusals, RLS).

Seed: the three accounts with roles and the two default rules (`prisma/seed.ts`).

Related: [[journal]], [[linking]], [[bank-accounts]], [[rates]], [[feature-inventory]] §3.10, the `bas-accounting` skill.
