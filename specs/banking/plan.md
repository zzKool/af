# Implementation Plan: Banking import + journal

**Branches**: `feat/banking-import` (part 1: model, parser, services, linkables, queries, tests, docs) → `feat/banking-pages` (part 2: pages, dialogs, e2e, screenshots) | **Date**: 2026-10-20 | **Specs**: `specs/banking/spec.md`, `specs/journal/spec.md`

## Summary

Two modules. `banking` keeps v2's accounts + format library + parser and adds imports, immutable transactions, categorisation rules and transfer-pair detection. `journal` is new: one entry per bank transaction (or typed by hand) with the SEK base written once and the owner's category / partner / note / flag. Banking depends on journal, linking, rates, documents, partners, settings; journal depends on rates, partners, settings, linking (registration only). The derived transaction state is a read model over `links` and the journal flag. Suggestions, inbox and the short-payment tolerance are the later *linking UI* feature.

## Technical Context

**Language/Version**: TypeScript, Next.js 16 / React 19 (unchanged)
**Primary Dependencies**: Prisma 7, Zod 4, next-safe-action, papaparse (v2), fast-check; no new packages
**Storage**: PostgreSQL 17 — enums `bank_account_role`, `rule_match_type`, `rule_match_field`, `rule_source`, `journal_source`, `journal_categorised_by`; tables `bank_imports`, `bank_transactions`, `categorisation_rules`, `journal_entries`; `bank_accounts.role`; triggers `bank_transactions_immutable`, `journal_entries_lock_money`, `block_delete_when_linked` on both; Nordea format `Date` alias
**Testing**: `csv-parser.test.ts` (+ D25 cases), `counterparty.pure.test.ts`, `rules.pure.test.ts` (fixture `testPatternCases`), `transfer-pairs.pure.test.ts`, `import.test.ts` (DB, fixtures), `rules.test.ts` (DB), `journal.test.ts` (DB), `dedup.pure.test.ts` (property), `e2e/banking.spec.ts` (part 2)
**Constraints**: no other open PR on `prisma/schema`, nav constants, i18n dictionaries; part 2 waits for part 1 on `main`

## Constitution Check

- §1 *derived never typed*: `open / partial / linked / no_document` computed in `queries.ts` from links and the journal flag; rules set facts (category, flag), never a status. ✔
- §1 *immutable money facts*: `bank_transactions` refuse every UPDATE (trigger); `journal_entries` lock amount / base / rate / source (trigger); `bank_implicit_rate` is set once. ✔
- §1 *linking is the product*: transfer pairs are `transfer` links; payments are `justifies` links (linking UI later); `bank_transaction` and `journal_entry` register as linkables; the source-side allocation invariant is added to the linking service. ✔
- §2 *module boundaries*: banking → journal (`createBankEntries`, `categorise`, `entriesForSources`, `deleteBySource`), → linking (`createLink`, `getLinksFor`, allocations), → rates (none directly — journal computes base), → documents (`storeGeneratedDocument` extended to CSV), → partners (`partnerNames`, `getPartner`), → settings (BAS codes). Journal → rates (`rateToBase`), partners, settings. No module imports banking except pages and the linkables registry. ✔
- §2 *cross-module references are validated UUIDs*: `bank_imports.document_id`, `journal_entries.source_id / partner_id / rule_id`, `categorisation_rules.partner_id` — no FKs. Intra-module FKs: `bank_transactions.bank_account_id / bank_import_id`. ✔
- §2 *money*: Decimal in services; strings on the surface. ✔
- §2 *no setting for a single use*: tolerances (2 days, 5 %) are constants in `transfer-pairs.ts`; the format library is data; rules are the owner's data. ✔
- §3b UI (part 2): `/banking` and `/journal` are list pages with a side panel; `/banking/rules` and `/banking/imports` lists with dialogs. ✔
- i18n: `banking.*`, `journal.*` keys en + fr. ✔
- Jobs: none in part 1 (detection is on request and cheap); the suggestions cache job comes with the linking UI. ✔

## Data model

```
bank_accounts            + role bank_account_role NOT NULL DEFAULT 'main'   (enum: main | savings)

bank_imports             id · tenant_id · bank_account_id (FK RESTRICT) · file_name · document_id? (uuid)
                         record_count · imported_count · duplicate_count · error_count · errors jsonb [] 
                         period_from? · period_to? (date) · imported_at · created_at · created_by · source
                         idx (tenant, bank_account_id), (tenant, imported_at desc)

bank_transactions        id · tenant_id · bank_account_id (FK RESTRICT) · bank_import_id (FK CASCADE)
                         booking_date date · amount dec(15,2) · currency char(3) · balance dec(15,2)?
                         sender? recipient? name? additional_details? message? own_notes? (text)
                         description text · reference? · counterparty_key text
                         dedup_hash char(64) · occurrence int ≥ 0 · row_index int
                         created_at · created_by · source   (no updated_at — never updated)
                         UNIQUE (bank_account_id, dedup_hash, occurrence)
                         idx (tenant, booking_date desc), (tenant, bank_account_id, booking_date), (tenant, counterparty_key), (tenant, bank_import_id)
                         CHECK currency = upper(currency)
                         trigger bank_transactions_immutable BEFORE UPDATE → RAISE 'bank_transaction_immutable'
                         trigger bank_transactions_block_delete_when_linked BEFORE DELETE → block_delete_when_linked('bank_transaction')

categorisation_rules     id · tenant_id · name varchar(200) · description? · match_type rule_match_type · match_pattern varchar(500)
                         match_field rule_match_field DEFAULT 'counterparty_key' · bas_code varchar(4)? · partner_id uuid?
                         no_document_needed bool · priority int (0–999, default 100) · is_active bool · source rule_source
                         hit_count int · last_hit_at timestamptz? · created_at · updated_at · created_by · source
                         UNIQUE (tenant_id, name) · CHECK (bas_code IS NOT NULL OR partner_id IS NOT NULL OR no_document_needed)
                         idx (tenant, is_active, priority desc)

journal_entries          id · tenant_id · source_type journal_source · source_id uuid? · entry_date date
                         description text · counterparty_key? · amount dec(15,2) · currency char(3)
                         amount_base dec(15,2) · rate dec(18,6) · rate_source varchar(20) · rate_date date? · bank_implicit_rate dec(18,6)?
                         bas_code varchar(4)? · partner_id uuid? · note? · no_document_needed bool
                         categorised_by journal_categorised_by? · rule_id uuid?
                         created_at · updated_at · created_by · source
                         UNIQUE (tenant_id, source_type, source_id) WHERE source_id IS NOT NULL  (declared @@unique(map:) for the drift check)
                         CHECK (source_type = 'manual') = (source_id IS NULL) · CHECK rate > 0 · CHECK currency upper
                         idx (tenant, entry_date desc), (tenant, bas_code), (tenant, partner_id), (tenant, categorised_by)
                         trigger journal_entries_lock_money BEFORE UPDATE: amount, currency, amount_base, rate, rate_source, rate_date,
                                 entry_date, source_type, source_id, description, counterparty_key never change; bank_implicit_rate only NULL → value
                         trigger journal_entries_block_delete_when_linked BEFORE DELETE
```

Nordea format: `column_mapping.columns[0].label` gains `aliases: ["Date"]`; the parser validates the header row against `label` or any alias.

## Services

**banking**
- `csv-parser.ts` (edit): header validation (`Not a Nordea export (expected columns …)`), `Date` alias, space thousands separator, hash over the raw columns, `occurrence` per file, `rawFields` by field name; returns `ParsedRow { date, amount, currency, balance, sender, recipient, name, additionalDetails, message, ownNotes, description, reference, counterpartyKey, dedupHash, occurrence, rowIndex }`.
- `counterparty.ts` (pure): `counterpartyKey(fields)`.
- `account-detect.ts` (pure): `detectAccountFromFilename(name)` → `{ number, currencyHint }`; `pickAccount(accounts, hint, firstRowCurrency)`.
- `import.ts`: `importCsv(tx, caller, audit, storage, { bankAccountId, fileName, bytes })` → `ImportSummary`; `deleteImport(tx, caller, audit, id)`; `ensureDefaultRules` (first import). Order inside the transaction: account → parse → currency check → dedup → insert transactions → store CSV document → `journal.createBankEntries` → `rules.applyToEntries` → import row → audit.
- `rules.ts`: schemas; pure `orderRules`, `matchRule(rule, fields)`, `firstHit(rules, fields)`; `createRule`, `updateRule`, `deleteRule`, `testRule`, `applyRules({dryRun})`, `applyToEntries(tx, caller, audit, rules, entries)`, `createRuleFromTransaction`.
- `transfer-pairs.ts`: pure `transferCandidates(a, candidates, ecbRate)` → `TransferProposal[]`; `proposeTransfers(tx, caller, transactionId)`; `acceptTransfer(tx, caller, audit, { fromId, toId })`.
- `linkable.ts`: `bankTransactionLinkable`.
- `queries.ts`: `TRANSACTION_COLUMNS`, `listTransactions` (two-step like invoices: stored filters in SQL, derived `state / partnerName / basCode / noDocumentNeeded / note / amountBase` from `journal.entriesForSources` + links; in-memory filter / sort / page; cap 20 000), `distinctTransactionValues`, `transactionDateHierarchy`, `getTransaction` (raw + entry + links + transfer proposals), `listImports`, `listRules`, `accountBalances`.
- actions: `importCsvAction` (FormData), `deleteImportAction`, rules CRUD/test/apply actions, `proposeTransfersAction`, `acceptTransferAction`, list/distinct/hierarchy actions, `getTransactionAction`.

**journal**
- `journal.ts`: schemas; `createBankEntries`, `createManualEntry`, `categorise`, `setBankImplicitRate`, `deleteBySource`, `deleteManualEntry`; `baseAmount(amount, rate)` pure.
- `queries.ts`: `JOURNAL_COLUMNS`, `listJournalEntries`, `distinctJournalValues`, `journalDateHierarchy`, `getJournalEntry`, `entriesForSources`.
- `linkable.ts`: `journalEntryLinkable`.
- actions: `createManualEntryAction`, `categoriseEntryAction`, `deleteManualEntryAction`, reads.

**linking** (edit): `createLink` also checks `Σ allocations from the source ≤ source amount` when the source summary carries an amount; `getAllocationStatus` unchanged; `kinds.ts` unchanged (pairs already allowed). DB side: a constraint trigger on `links` (AFTER INSERT, deferrable) comparing Σ against the source's amount is not possible without cross-table reads of polymorphic sources — documented as service-enforced (constitution §2 allows service-level for polymorphic endpoints; the target side stays DB-checked).

**documents** (edit): `storeGeneratedDocument` accepts `mimeType: "application/pdf" | "text/csv"` and an optional `documentType` (`financial` default) — the CSV goes in as `prefixType: "bank_statement"`, status `generated` (read-only, no OCR, undeletable while linked).

## Project Structure

```
prisma/schema/banking.prisma            (+ role, BankImport, BankTransaction, CategorisationRule)
prisma/schema/journal.prisma            (JournalEntry + enums)
prisma/migrations/20261021100000_add_banking_import_and_journal/migration.sql
src/modules/banking/{csv-parser,counterparty,account-detect,import,rules,transfer-pairs,linkable,queries,types}.ts
src/modules/banking/{import,rules,transfer-pairs}.actions.ts
src/modules/banking/{counterparty,rules,transfer-pairs,dedup}.pure.test.ts · {import,rules}.test.ts
src/modules/banking/components/   (part 2: transaction-table, transaction-panel, import-dialog, rules-table, rule-dialog, imports-table)
src/modules/journal/{journal,queries,linkable,types}.ts · journal.actions.ts · journal.test.ts · base.pure.test.ts
src/modules/journal/components/   (part 2: journal-table, categorise-form, manual-entry-dialog)
src/app/(app)/banking/{page,imports/page,rules/page}.tsx · src/app/(app)/journal/page.tsx   (part 2)
specs/banking/{spec,plan,tasks}.md · specs/journal/spec.md · docs/banking.md · docs/journal.md
```

## Complexity Tracking

| Choice | Why | Simpler alternative rejected |
|---|---|---|
| Journal as its own module | the ledger outlives banking (manual entries, future expenses/supplier facts link through it); banking → journal is one-way | entries as columns on `bank_transactions` — would force manual facts into a fake transaction |
| Two-step list query with in-memory derived columns | state / category / partner live in `links` and `journal_entries`; same pattern as invoices, proven | SQL view — would couple three modules' tables in one query |
| Transfer detection on request, no job | ≤ 3 accounts, ± 2-day window: a handful of rows per call | a cached suggestion table — premature until the scorer exists |
| Default rules on first import | the kernel cannot call a module from the tenant hook | a tenancy hook registry — a framework for one use |
