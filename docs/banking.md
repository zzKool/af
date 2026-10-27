# Banking — Nordea import, transactions, categorisation rules, transfer pairs

Module `src/modules/banking` · schema `prisma/schema/banking.prisma` · migrations `20261021100000_add_banking_import_and_journal`, `20261027120000_one_transaction_table`, `20261027200000_owner_private_role` + `20261027200100_link_payment_record` (F114) · specs `specs/banking/` (harvest, spec, plan, tasks), `specs/banking/one-table.md` (F113) and `specs/linking/payment-record.md` (F114, the payers) · decisions D3, D13, D18, D25, D31, D59, D60. Part 1: model, parser edits, import, rules, transfer pairs, linkables, queries. Part 2: the workbench, the imports and rules pages. Since F113 (2026-10-27) the row carries its own facts — the [[journal]] module is gone.

> A bank transaction is one CSV row, kept verbatim: the bank's columns and the SEK base (rate, source, date — written once by the import) are locked by the database; the owner's facts about it — BAS category, partner, note, *no document needed* — are on the same row and change freely (F113, D59). *Open / partially linked / linked / no document needed* are **derived** from the links and the row's flag. Rules set facts, never a status; transfer pairs are `transfer` links — and only links: accepting one writes nothing on the legs (F65).

## Model

```
bank_accounts         (v2) + role ∈ main | savings | owner_private — the savings CSV goes to the accountant yearly (D13/D31), nothing else;
                      owner_private (F114, D60) = the owner's private instruments (`Private SE`, `Private CH`): no CSV format (bank_format_id is
                      NULL only for them — a CHECK), no rows, never imported into; what a private expense names as its payer
                      UNIQUE (tenant_id, id) — the composite key `expenses.paid_from_account_id` / `subscriptions.paid_from_account_id` point at (D63)
bank_imports          account · file_name · document_id (the stored CSV, validated UUID) · record/imported/duplicate/error counts
                      errors [] · period_from / period_to (min/max booking date) · imported_at
bank_transactions     account · import · booking_date · amount (signed) · currency · balance? (end-of-day, last row of a day only)
                      sender · recipient · name · additional_details · message · own_notes   (the six raw columns, verbatim)
                      description · reference · counterparty_key · dedup_hash · occurrence · row_index
                      amount_base (SEK, 2 dp, signed like amount) · rate (6 dp) · rate_source ∈ same_currency | ecb_daily | ecb_nearest (the shared enum; `bank` refused by a CHECK) · rate_date?
                      bas_code? · partner_id? (composite FK to partners, RESTRICT — D63) · note? · no_document_needed · categorised_by ∈ manual | rule | null · rule_id?
                      UNIQUE (account, dedup_hash, occurrence) · trigger bank_transactions_lock_facts (the bank's columns and the base refuse an UPDATE; the owner's facts pass)
                      trigger block_delete_when_linked('bank_transaction') · UNIQUE (tenant_id, id) — `settlements.bank_transaction_id` points at it (F114)
categorisation_rules  name (unique) · match_type ∈ contains|starts_with|ends_with|exact|regex · match_pattern
                      match_field ∈ counterparty_key (default)|name|details|message|sender|recipient|all
                      bas_code? · partner_id? · no_document_needed · priority 0–999 · is_active · rule_source ∈ manual|learned
                      hit_count · last_hit_at · CHECK (sets at least one of category / partner / flag)
```

Cross-module references: `partner_id` is a composite `(tenant_id, id)` FK to `partners` (RESTRICT, D63 — the first one); `document_id` and `rule_id` stay validated UUIDs until their modules' next schema PR. `bank_transactions.bank_account_id / bank_import_id` are intra-module FKs (RESTRICT / CASCADE).

`journal_entries` still exists in the database after F113's migration, read by nothing — PR B drops it after one real month on the box (D65, [[roadmap]]).

## The parser — `csv-parser.ts` (v2, three D25 edits)

Buffer + format config → rows. (1) The header row is validated against the format's labels **or their aliases** (`Date` for `Booking date` — the owner's real exports say `Date`); anything else is *Not a Nordea export*. (2) A space thousands separator (`-1 500,00`) is accepted. (3) The dedup hash is `sha256(date | amount | currency | sender | recipient | name | additional details | message)` — never the row's position, the balance (end-of-day only) or the owner's notes (editable in Nordea); identical rows of one file get `occurrence` 0, 1, … Dates are checked as calendar dates; a bad row is reported (`Row 7: invalid amount "abc"`) with the others parsed around it — and **the import refuses the whole file** when any row failed (F109, audit 2026-10-27 B5): *2 rows could not be read — Row 2: …; Row 3: … — nothing was imported* (`VALIDATION_ERROR`, `details.errors` one per line). Proof-per-transaction books cannot afford a silently missing row; the owner fixes the export or the format once. The old formula-injection flag (`+`, `-`, `=`, `@` as a first character) is gone — nothing here is a spreadsheet, and it padded `errorCount` with noise. `bank_imports.error_count` / `errors` are therefore always 0 / `[]` from now on (kept for the history).

Derived text: `description` = name → additional details → sender → recipient → *Unknown transaction*; `reference` = the `Message` column verbatim; `counterparty_key` (`counterparty.ts`, Excel *Column1*) = name, else the details without the card prefix (`Kortköp 260727 OPENAI *CHATGPT SUBS` → `OPENAI *CHATGPT SUBS`), else message / sender / recipient; upper-cased, trailing 4-digit card suffix dropped, whitespace collapsed.

`account-detect.ts`: the filename pre-selects the account (`PLUSGIROKONTO FTG 123 45 67-8 - …` → the number; the first row's currency picks between the SEK and CHF main accounts that share it). A hint for the dialog, never a creation.

## The import — `import.ts`

`importCsv(tx, caller, audit, storage, {bankAccountId, fileName, bytes})`, one transaction, nothing written before every check passed:

1. parse (header, rows, per-row errors) · 2. every row's currency = the account's, else *Currency CHF in file does not match account Plusgirokonto SEK (SEK)* · 3. dedup per account on `(hash, occurrence)` (`planImport`) · 4. a base rate is resolved for every new booking date (`facts.resolveRate`: SEK → rate 1 `same_currency`; CHF → ECB of the booking date, nearest weekday; *No exchange rate for 2026-07-08 — run the ECB sync*) · 5. the CSV stored as a document (`documents.storeGeneratedDocument`, `text/csv`, `bank_statement`, status `generated`, key `Bank_Plusgirokonto-SEK_2026-07-03_2026-07-28.csv` from `numbering.bankStatementKey` — even when every row was a duplicate: the package needs the file) · 6. the import record · 7. the transactions in file order, each with its base (`amount_base = round(amount × rate, 2)`, audited) · 8. the active rules on the new rows (the two defaults are created first when the tenant has none — `ensureDefaultRules`).

A failure after the first write is **thrown** as `RollbackError` (kernel/errors) so the transaction rolls back whole; the action client returns its `appError` like a returned error. (A returned `ServiceResult` error would commit the partial write — the middleware commits whatever the handler returns.)

`deleteImport`: refused when any of its transactions is linked (`linking.linksTouching` + the delete trigger); else the transactions and the record go, audited. `deleteBankAccount` refuses while imports exist.

## Rules — `rules.ts`

Pure: `orderRules` (active, priority desc → longer pattern → newest), `fieldText` (`all` = the five text columns joined), `matchRule` (case-insensitive; an invalid regex never matches, never throws), `firstHit`. Fixture `specs/banking/fixtures/categorisation-rules-sample.json#testPatternCases` runs in `rules.pure.test.ts`.

Service: `createRule` / `updateRule` / `deleteRule` (name pre-checked — a unique violation would abort the Postgres transaction; BAS code through `settings.getBasCategory`, partner through `partners.getPartner`, regex compiled on save), `testRule` (matches / tested over the newest 500 uncategorised rows), `applyRules({dryRun})` (every active rule over every uncategorised row — `facts.uncategorisedTransactions`; dry run previews ≤ 50 and writes nothing), `applyToTransactions` (the import's call; a rule's `hitCount` / `lastHitAt` count only the hits that changed the row — a match the never-overwrite rules turn into a no-op is not a hit, lessons audit 32), `createRuleFromTransaction` (pre-filled from the counterparty key and the row's facts, `learned`, applied to that row at once), `ensureDefaultRules` (`AVGIFTER NORDEA` → 657 no document; `^(R[äa]nta|Interest)\b` on the details → 831 no document).

A hit writes through `facts.categorise(…, {by: "rule", ruleId})`: category when the row has none (a partner-only rule brings the partner's default category), partner when none, the flag OR-ed; a row categorised **by hand is never touched**. Counters (`hit_count`, `last_hit_at`) move on real applies.

## The row's facts — `facts.ts` (F113; the journal's service, on the row)

`baseAmount(amount, rate)` (round half-up, 2 dp, never `-0`) · `resolveRate(tx, date, currency)` / `baseFor` (the base rule above, through [[rates]] `rateToBase`) · `categoriseSchema` + `categorise(tx, caller, audit, id, {basCode?, partnerId?, note?, noDocumentNeeded?}, {by?, ruleId?})` — by hand: what is given is written, `categorised_by = manual`, `rule_id` cleared; by a rule: the never-overwrite rules above; the audit row holds the owner's facts only (`ownerFacts`), so the History diffs them · `transactionFacts(tx, ids)` → `Map<id, BankTransactionDto>` (what expenses, supplier invoices and the package read for the row's base) · `uncategorisedTransactions(tx, limit)`. The BAS code is checked through [[bas-categories]] (`settings.getBasCategory`), the partner through [[partners]]. `facts.ts` never reads the links: `banking.actions` reads `categoriseSchema` at load time and linking's registry loads every module, so a static edge from here to linking would close the load cycle the journal hid behind `await import` ([[lessons]]) — the implied rate of a transfer pair is `implicit-rate.ts` (`impliedRate`, `withImplicitRates`), read by `queries.ts` only.

## Transfer pairs — `transfer-pairs.ts`

Pure `transferCandidates(a, others, ecbRates)`: another own account, opposite sign, ≤ 2 days apart; same currency → equal amounts (rate 1); else `implied = |SEK| ÷ |foreign|` within 5 % of the ECB rate of `a`'s date **for that pair's foreign currency** (`ecbRates`: currency → SEK per unit; `proposeTransfers` fetches one rate per foreign currency among the legs — a SEK row meeting a CHF and a EUR candidate compares each with its own rate, lessons 32). Hints (`CHANGE`, `CHFSEK`, `ÖVERFÖRING`, the other account's number in the text) raise the confidence shown, never required. Constants, not settings.

`proposeTransfers(tx, id)` (empty once paired) · `acceptTransfer(tx, caller, audit, {fromId, toId})` → one `transfer` link debit → credit (through [[linking]]); the foreign leg's implied rate is derived from that link on read (`implicit-rate.ts` `withImplicitRates` — nothing stored, F86) and its `rate` / `amount_base` stay ECB, D3. **Nothing else is written on the legs** (F65, D44): no `no_document_needed`, no `categorised_by = manual` — so rules still categorise an accepted leg, and unpairing (removing the link) leaves both rows exactly as before. The state *no document needed* of a leg is derived from the link. Unpairing takes the implied rate away with the link; a re-pair shows the new pair's. The owner's July pair: −20 000.00 CHF ↔ +237 740.00 SEK → 11.887 (fixtures `nordea-transfer-pair-*.csv`).

## Derived state and lists — `queries.ts`

`deriveTransactionState({amount, allocated, inTransfer, noDocumentNeeded})`: `no_document` when the flag is set **or the row is in a `transfer` link** (the other statement row is its proof — F65); `linked` when `Σ allocations ≥ |amount| − tolerance` (the kernel's `isSettled`, D25); `partial` when Σ > 0; else `open`. Never stored. The facts come through [[linking]]'s read API — `linkFactsOf(links, rows)` (`link-facts.ts`, pure, F114): Σ allocated FROM the row **in the row's currency** over the allocating kinds (`justifies` / `settles`), a cross-currency link counting by the share of the row's base it took (`allocated_base` over the row's base — linking's `rowRemaining`, the one rule the list, the Months panel, the sidebar's count and the package share), and the transfer legs; the links by `linksTouching` — banking reads no `links` table itself (lessons audit 22).

`TRANSACTION_COLUMNS` is the DataTable contract; the list runs in two steps (Prisma on the stored columns — the base and the owner's facts are columns now, F113 → Σ allocations through `linkFactsOf`, the implied rates, partner names and BAS labels joined over that set → derived filters, search, sort, page and sums in memory through `kernel/list-query/memory`, cap 20 000). `distinctTransactionValues` / `transactionDateHierarchy` keep Excel semantics. `getTransaction` returns the row with its facts and implied rate, the state, the links with the other side's label and the transfer proposals. `getTransactionAction` hands it to the panel as `TransactionDetailWire` (`detail-wire.ts`: the timestamps as ISO strings), the type the panel reads — no cast on the client (lessons 29). `listImports`, `listRulesWithLabels`, `accountBalances` (the balance of the latest booking date that has one — no stored running balance). Since F71 the imports and rules pages are DataTables too: `IMPORT_COLUMNS` / `RULE_COLUMNS` with `listImportsPage` / `listRulesPage`, `distinctImportValues` / `distinctRuleValues`, `importDateHierarchy` / `ruleDateHierarchy` — a handful of rows, so every column is evaluated in memory (`memoryTable`, the same `kernel/list-query/memory` semantics); `accountLabel` is an `enum` column (a checkbox filter of account names). `rawRowsForPeriod({from, to, by: "booking" | "import", role?})` — the raw rows of a period with their account, source file and the account's CSV conventions, booking date then file order: what the [[accountant-package]] writes as `bank-statements/*.csv`. `accountAliasesFor(tx, transactionIds)` → `Map<transactionId, accountLabel>` in one query.

## The Months panel — `months.ts` (F69)

A read model, no table: `bankMonths(tx, {today})` → per month from the first month an import covers (at least twelve months back) to today's month:

```
bank rows of the window ─┐
the row's flag (no doc) ─┼─► deriveTransactionState ─► justified  = linked | no_document
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

CRUD on Settings → Bank accounts ([[bank-accounts]]) — the **statement accounts** (`STATEMENT_ROLES` = main | savings; `checkRole`). Once a CSV is imported into an account its **number and currency are locked** (F65): `updateBankAccount` refuses a change of either with *This account has N import(s); its number and currency can no longer change* (`BUSINESS_RULE_VIOLATION`, `details.imports`) — they say which rows belong to it. Alias, IBAN / BIC, format and role still change. `getBankAccounts` returns `BankAccountDto[]` with `imports` (the count; `bankFormatId` / `bankFormat` nullable — null only on a private instrument) and the settings tab disables the two fields when it is > 0; `getBankFormats` returns `BankFormatDto[]` — the format's conventions and its column mapping parsed (`parseColumnMapping`, null when it does not fit); neither leaks the Prisma row (lessons audit 30). Delete is refused while imports exist.

**Payers — `payers.ts` (F114, D60).** Who can pay an expense or a subscription is a bank account: `payerAccounts(tx)` → `PayerAccount[]` (id, label, currency, role, `kind` ∈ bank_account | private — `payerKindOf(role)`, a lookup, never a role comparison in a module) — the main accounts first (the company paid; a `justifies` link from the row proves it), then the owner's **private instruments** (`role = owner_private`; a `settles` link from the refund row reimburses them); savings pay nothing. `payerAccount(tx, id)` resolves one. `createPrivateAccount({alias, currency})` is the only way to make one — the alias is the number too, no format, no IBAN; `importCsv` refuses a private instrument (*has no statement*). The seed makes `Private SE` (SEK) and `Private CH` (CHF). Settings → Bank accounts shows them under **Private instruments** (`PrivateInstruments`: the list and *Add*), apart from the statement accounts. The `payment_sources` table of expenses is gone — the F114 migration turned each private source into an `owner_private` account and repointed the expenses.

## History — `history.ts` (F71)

`transactionHistory(tx, id)` reads two audit trails through `kernel/audit` `getAuditLog` and maps them (`toHistoryEvents`, pure): the row's own `create` = **Imported** and its `update`s (a categorisation, F113 — the updates written on journal entries before were appended onto the row's trail by the migration) = **Categorised 657** / *Category removed* / *Partner changed* / *Marked no document needed* / *Document needed again*, each with who decided it (rule, by hand, partner default); each live link's `create` = **Linked: Supplier invoice (justifies)** (the other end's type, the kind). An update that changes nothing the owner sees (a note) is dropped. A **removed** link is not shown: its row is gone and the kernel reads a trail by entity id only ([[lessons]], F71 banking History).

## Read API for other modules (lessons audit 23)

Expenses and supplier invoices read `bank_transactions` themselves today; these replace those reads (the callers move in their own lanes):

- `outgoingRowsInWindow(tx, { bankAccountIds, from, to })` → `WindowRow[]` (F94): outgoing rows of those accounts booked inside the window (inclusive), oldest first, *linked* / *no document* rows dropped, with every text field, the row's partner / category / flag, |base| and what is left — the subscriptions matcher's candidates.
- `outgoingMainRows(tx, limit)` → `OutgoingMainRow[]`: outgoing rows on **main** accounts, newest first (`id` breaks ties), with the base — the settle / attach pickers and *Link payment* start from it and filter their own (settling rows, nothing left to allocate).
- `bookingDates(tx, ids)` → `Map<id, YYYY-MM-DD>`; unknown ids absent.
- `firstBookingDate(tx)` → `YYYY-MM-DD` of the first bank row, or null — the package's `firstMonth` reads it.
- `transactionStates(tx, ids)` → `Map<id, { state, allocated, inTransfer }>`: the derived state with the facts it comes from (Σ allocated FROM the row, the transfer leg) — the package's bank sheet reads it instead of re-deriving them from the links; unknown ids absent.

## Linkable

`bankTransactionLinkable`: label `2026-07-08 · -20000.00 CHF · CHANGE CHFSEK`, amount `|amount|`, currency. The linking service now checks the **source side** of an allocation too: Σ allocations from one transaction never exceed its amount, in its currency.

## Surface

- `index.ts`: parser, counterparty, account detection, import, the row's facts (`facts.ts`, `implicit-rate.ts`), the option lists (`options.ts`: `categoryOptions`, `partnerOptions`), rules, transfer pairs, queries (with the read API above), `transactionHistory`, linkable, DTOs and constants.
- `ui.ts`: actions, components (`CategoriseForm` among them) + types.
- Actions (`banking.actions.ts`): reads on `authedAction` + `can(read, bank_transaction)` (the accountant reads); `categoriseTransactionAction`, `importCsvAction` (FormData: file + account), `detectAccountAction`, `deleteImportAction`, rule CRUD / test / apply / from-transaction, `getTransactionHistoryAction` (a read), `proposeTransfersAction`, `acceptTransferAction` on `ownerAction`.
- `modules/linking/linkables.ts` registers `bankTransactionLinkable` — the one identity of a bank movement.

## Pages (part 2; the D40 kit since F71)

States go through **one** map, `state-family.ts` (`open` → attention, `partial` → in progress, `linked` → done, `no_document` → neutral), rendered by `TransactionStateLabel`; money on screen through `formatMoney`; no Tailwind palette colours, no pastel chips.


- `/banking` — `ListPage`, title row: *Inbox* · *Imports* · *Rules* · **Import CSV** (the one primary — `WorkbenchActions` in `header-actions.tsx`; `?new=1` — the sidebar's **+ New → Import bank CSV**, F73 — opens it too, through the kernel's `useNewParam`, and closing drops the param; the `ImportDialog`: file → the account pre-selected from the file name and the first row's currency (`detectAccountAction`) → summary with the period, the rules applied and *Show the new rows* = the list filtered on that import); banner: the Months banner above; the **Months panel** (F69, above); `TransactionTable` (DataTable on `TRANSACTION_COLUMNS`: the state as a `<StateLabel>`, the amount signed in the row's currency through `formatMoney` (positive in `--state-done`), footer sums of `amount` and `amountBase`, **Date** and **Account** as quick filters, category / partner / import filters labelled by name; the account balances on the right of the filter bar — a click = the Account filter on that account, again = off; the as-of date in its tooltip). A row opens the **docked details panel** (`TransactionPanel`): the title (date · amount · state) and the account as a `<Tag>`; the transfer proposal as an `InfoBanner` with *Accept as transfer*; then `DetailsSection`s — *As the bank said* (About: the Nordea columns, the balance, the counterparty key as a `<CodeChip>`, the source file), *Links* (Proof: the links with *Unlink* — `LinksList`, the graph link, the **suggestions** with *Link* / *Link to…* — `SuggestionsSection` from [[linking]], hidden once the row needs no document), *Category* (the base and rate, `CategoriseForm` — saved on change through `categoriseTransactionAction`, the saved row shown at once — and *Create rule from this*: the `RuleDialog` pre-filled from the counterparty key and the row's facts, `learned`); for an open outgoing row the **Justify** section comes first (`JustifyPanel` from [[linking]], F97: drop the proof → the compare card → *Create & link*; no proof needed; receipt lost — the page hands the panel its option lists, `justifyOptions`, for the owner only). and **History** (collapsed — `TransactionHistory`: what happened to the row, newest first, read from the audit trail by `transactionHistory` / `getTransactionHistoryAction`, reloaded after each save in the panel; nothing stored — see *History* below). The panel's body is `TransactionDetailView`, shared with the inbox's right pane.
- `/banking/imports` — `ImportsTable` (DataTable): the file name is the row link (its rows on the workbench), account (quick filter), period, counts, imported at; ⋮ → *Delete* (confirm; refused while linked). Title row: **Import CSV** (`?new=1` opens it too, F73).
- `/banking/rules` — `RulesTable` (DataTable, the order the rules run in: priority, then name): the name opens the edit dialog (`RuleDialog`, regex behind *Advanced*, *Test* = matches over the newest uncategorised rows), source as a `<Tag>`, *Active* a column (was a faded row); ⋮ → *Edit* / *Delete*. Title row: *Apply rules* (dry run → a confirm dialog with the preview → *Apply now*) · **New rule** (`RulesActions`).
- Settings → Bank accounts gains the *Role* select (main / savings).
- Nav: *Banking* for owner and accountant (reads: the panel is read-only, no import / rules / accept). Strings `banking.*` en + fr + sv.
- Kernel kit additions for these pages: `components/ui/dialog.tsx` and `components/ui/sheet.tsx` (Base UI, same shape as `alert-dialog.tsx`); the DataTable now labels filter chips and footer sums by header even for hidden columns.

E2E `e2e/banking.spec.ts` (SEK only — CI has no ECB rates): the July sample → fee rule applied → categorise the OpenAI row by hand → *create rule from this* → the savings file (interest rule) and the SEK leg → accept the transfer pair → its *History* (*Linked: Bank row (transfer)* above *Imported*) → the rules page, the categories on the list, the imports page. Screenshots: `specs/banking/screenshots/` (import dialog, summary, rule dialog, transfer proposal / accepted; since F71 the workbench, the panel, rules and imports light + dark; `f71-history-*` the panel's History).

## Tests

`link-facts` in `months.pure.test.ts` (F114: a cross-currency link counts by the base share) · `bank-accounts.test.ts` (F114: `payerAccounts` order and kinds, `createPrivateAccount`, a private instrument refuses an import) · `csv-parser.test.ts` (v2 + D25: `Date` header, July sample, Swedish headers rejected, space thousands, calendar dates, hash independence) · `counterparty.pure.test.ts` · `account-detect.pure.test.ts` · `dedup.pure.test.ts` (fast-check: re-import = 0 new, superset = the extra rows, balance/notes outside the key) · `state-family.pure.test.ts` (F71: every derived state has a D40 family, and the attention / in-progress ones are exactly the Months panel's *to justify*) · `rules.pure.test.ts` (fixture cases, `all` = `bankText` — the one join the transfer hints read too, invalid regex, ordering) · `transfer-pairs.pure.test.ts` · `state.pure.test.ts` (the tolerance edge, and as a property the state equals the rule written out by hand) · `months.pure.test.ts` (month arithmetic, the cell rule, the banner's month, link facts) · `months.test.ts` (DB: a transfer-pair month before / after accepting, not-imported months and an import period without rows, the banner with a queued then a built package, the window, RLS) · `import.test.ts` (DB: US1 scenarios on the fixtures, immutability by SQL, delete with/without links, RLS; US3 the pair and the savings move, pair → unpair leaves the facts and states as before, a rule categorises an accepted leg; F65 an imported account's number / currency refused; US4/US5 state and the source-side invariant) · `history.pure.test.ts` (F71: which audit rows give which events, a link's other end from either side, newest first) · `reads.test.ts` (DB: the History of an imported, categorised, flagged, paired row and of its other leg, RLS; `outgoingMainRows` main-only / newest first / capped, `bookingDates`, `firstBookingDate`, `transactionStates` open / flagged / transfer legs as the list derives them, RLS) · `rules.test.ts` (DB: defaults on first import, apply dry/real, partner default, manual never overwritten, learned rule, refusals, `hitCount` without no-op hits, RLS).

Seed: the three statement accounts with roles, the two private instruments (`owner_private`) and the two default rules (`prisma/seed.ts`).

Related: [[journal]] (superseded), [[linking]], [[bank-accounts]], [[rates]], [[feature-inventory]] §3.10, the `bas-accounting` skill.

## The sidebar's and the dashboard's count (F72, F82)

`rowsToJustifyCount(tx)` (`open-work.ts`) — the main accounts' rows still to justify (open | partial): the sidebar's *Banking* badge, loaded with every page by the app layout, and since F82 the dashboard's *rows to justify* (it used to list and derive every row for the `total`). Two reads: the rows that could still be open (id, amount — the *no document needed* flag is a column, F113, so the database drops those) → the links touching them (`linkFactsOf`: Σ allocated, transfer legs); the state is `deriveTransactionState`. `open-work.test.ts` holds it against `listTransactions(state ∈ open, partial)` — open rows, the fee, savings, a transfer pair, a fully and a partly justified row (F82).

Banking reads no other module's table outside its tests (F66, lessons audit 22–24): links through [[linking]]; partner names through [[partners]], BAS labels through [[bas-categories]].
