# Feature Specification: Banking — Nordea import, transactions, categorisation rules, transfer pairs

**Feature Branch**: `feat/banking-import` (part 1: model, parser edits, import, journal entries, rules, transfer pairs, linkables, queries) · `feat/banking-pages` (part 2: workbench, imports, rules and journal pages)

**Created**: 2026-10-20

**Status**: Ready for planning (B7, B8, B9, D-a, D-b answered → D25, D31; harvest `specs/banking/harvest.md`; the journal side in `specs/journal/spec.md`)

**Input**: "Once a month the owner exports three Nordea CSVs (SEK main, CHF main, savings — the savings one once a year) and drops them in. Every row becomes an immutable bank transaction and a journal entry with its SEK base; re-importing an overlapping export adds nothing twice; the rows he always categorises the same way (OPENAI, MSFT, AVGIFTER NORDEA, SKATTEVERKET, SALARY, Ränta) categorise themselves and the ones the statement itself proves are flagged *no document needed*; the `CHANGE CHFSEK` pair is recognised as one transfer and carries the bank's rate. The rest waits in the workbench to be linked to invoices, receipts and supplier invoices — that is the linking UI, not this feature."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import a month of Nordea rows (Priority: P1)

The owner opens *Banking → Import*, drops `PLUSGIROKONTO FTG 123 45 67-8 - 2026-07-31 09.12.01.csv`; the dialog pre-selects *Plusgirokonto SEK* from the filename and shows the account's currency. He confirms. The summary reads *31 rows · 31 imported · 0 duplicates · 0 errors · 2026-07-01 → 2026-07-31*; the CSV itself is stored as a document (`Bank_Plusgirokonto-SEK_2026-07-01_2026-07-31.csv`) for the accountant package. Every row is now a transaction in the workbench with its journal entry: SEK rows at rate 1, CHF rows at the ECB rate of the booking date. Next month he exports again with a window that overlaps July's last days: those rows are counted as duplicates and skipped — including card rows that have no reference.

**Why this priority**: nothing else in banking exists without the rows; the dedup rule is what makes "just drop the file in" safe.

**Independent Test**: import `fixtures/nordea-2026-07-sek-sample.csv` into a SEK account, read back the transactions and journal entries; import it again → 0 new; import a copy shifted by a few rows → only the new rows.

**Acceptance Scenarios**:

1. **Given** a SEK account and the July sample (header `Date`, card rows with empty `Name`, `Balance` only on the last row of a day) **When** imported **Then** every data row becomes a `bank_transaction` with the raw columns verbatim, `description` (`name → additional details → sender → recipient → "Unknown transaction"`), `counterparty_key` (`OPENAI *CHATGPT SUBS` from `Kortköp 260727 OPENAI *CHATGPT SUBS`), `reference` (the `Message` column verbatim), and a `journal_entry` with `amount_base = amount`, `rate = 1`, `rate_source = same_currency`.
2. **Given** the same file imported again **When** the summary is shown **Then** `imported = 0`, `duplicates = rows`; **Given** a later export whose window overlaps **Then** only rows absent from the database are imported — the dedup key is `sha256(date | amount | currency | sender | recipient | name | additional details | message)` per account plus the in-file occurrence index (D25); balance and own notes never take part.
3. **Given** `fixtures/nordea-bank-fee-duplicate-rows.csv` (two identical fee rows, same day) **When** imported **Then** both rows exist (occurrence 0 and 1); imported again → 0 new.
4. **Given** a CHF account and `fixtures/nordea-transfer-pair-chf.csv` **When** imported **Then** the journal entry carries `amount_base = |amount| × ECB CHF→SEK of 2026-07-08` (nearest weekday when the day has none), `rate_source = ecb_daily | ecb_nearest`, `rate_date`; **Given** no ECB rate at all for the period **Then** the import is refused with *No exchange rate for 2026-07-08 — run the ECB sync* (never a null base).
5. **Given** a file whose `Currency` column says `CHF` **When** imported into the SEK account **Then** refused: *Currency CHF in file does not match account Plusgirokonto SEK*; nothing is written.
6. **Given** `fixtures/v1-swedish-headers.csv` (comma-delimited, Swedish headers) **When** imported **Then** refused: *Not a Nordea export (expected columns Date/Booking date, Amount, Sender, …)*; **Given** an empty file or headers only **Then** refused with the parser's message.
7. **Given** a row with an invalid amount or date **When** imported **Then** that row is listed under `errors` (`Row 7: invalid amount "abc"`) and the other rows are imported.
8. **Given** the filename `SPARKONTO FÖRETAG 1234 56 78901 - 2026-12-31 10.00.00.csv` **When** the dialog opens **Then** the savings account is pre-selected (number from the filename, currency from the first row); an unknown filename pre-selects nothing and the owner picks.
9. **Given** an import whose transactions are all unlinked and uncategorised by hand **When** the owner deletes the import **Then** its transactions and their journal entries go with it (audited); **Given** one transaction is linked **Then** refused.

---

### User Story 2 - Rows that categorise themselves (Priority: P1)

The owner keeps a short list of rules: *contains `OPENAI` on the counterparty → BAS 654 (Ut), partner OpenAI*; *contains `AVGIFTER NORDEA` → bank fees, no document needed*; *starts with `Ränta` → interest income, no document needed*. Rules run on every import on the new rows and can be run again on demand (dry run first). From any transaction he can click *Create rule from this* — the pattern is pre-filled with the counterparty key, the category with what he just chose — one click and next month's row is done before he sees it.

**Why this priority**: it removes most of the monthly clicking; the Excel's grey rows become facts the app sets.

**Independent Test**: seed the sample rules, import the July sample, assert the categories, partners and flags on the journal entries; run the apply dry-run and the real apply; create a learned rule from a transaction.

**Acceptance Scenarios**:

1. **Given** active rules **When** a file is imported **Then** each new transaction is tested against the rules (priority desc → longer pattern → newest), the first hit sets `bas_code`, `partner_id` and `no_document_needed` on the journal entry, `categorised_by = rule` with the rule id; `hit_count` / `last_hit_at` move; a miss leaves the entry untouched.
2. **Given** `contains / starts_with / ends_with / exact` **When** tested **Then** case-insensitive on the chosen field (`counterparty_key` default, `name`, `details`, `message`, `sender`, `recipient`, or `all` = the five text columns joined); an invalid `regex` never matches and never throws; empty text never matches.
3. **Given** a rule that sets a partner but no category **When** it hits **Then** the partner's default BAS category fills the category; a partner already set by hand is never replaced by a rule.
4. **Given** a transaction categorised by hand (`categorised_by = manual`) **When** rules are re-applied **Then** it is never touched; only uncategorised entries are candidates.
5. **Given** *Apply rules* with dry run **When** run over the uncategorised entries **Then** the preview lists ≤ 50 would-be hits and nothing is written; the real apply writes them and returns `applied / tested`.
6. **Given** *Create rule from this transaction* **When** opened **Then** the form is pre-filled: pattern = `counterparty_key`, type `contains`, field `counterparty_key`, category / partner / flag = the entry's current values, priority 100, source `learned`; saving creates the rule and applies it to that transaction.
7. **Given** a rule name already used, an unknown BAS code, a partner of another tenant or an invalid regex **When** saved **Then** refused with the matching message.
8. **Given** a tenant with no rule at all **When** its first import runs **Then** two default rules are created first and applied: `AVGIFTER NORDEA` → bank fees (657), no document needed; `Ränta` / `Interest` (regex `^(R[äa]nta|Interest)\b` on the details) → interest income (831), no document needed. (`Skatteverket`, `SALARY`, `OPENAI`, `MSFT` are the owner's to add — their categories are his accountant's call.)

---

### User Story 3 - The CHANGE CHFSEK transfer pair (Priority: P2)

A currency exchange between the two Plusgiro accounts shows as two rows: −20 000.00 CHF on the CHF account (`Recipient` = the SEK account number, `Additional details` = `CHANGE CHFSEK 999999-5`, `Message` = `CHANGE CHFSEK`) and +237 740.00 SEK on the SEK account, same booking date. The workbench proposes them as a pair with the implied rate 11.887 beside the ECB rate; *Accept* links them (`transfer`) and records the bank implicit rate on the CHF entry; both then read *no document needed*, derived from the link (D44). A move to the savings account is the same at rate 1.

**Independent Test**: import both fixture files, ask for the transfer candidates of the CHF row, accept, read back the link and the two journal entries.

**Acceptance Scenarios**:

1. **Given** the two fixture rows **When** candidates are computed for the CHF row **Then** the SEK row is proposed with `implied = 11.887`, the ECB rate of the day, and the reason *Transfer pair: 20 000.00 CHF ↔ 237 740.00 SEK, implied 11.887 (ECB 11.90)*; the pair is only proposed when `|date gap| ≤ 2 days`, opposite signs, both on own accounts, neither already in a transfer link, and `|implied / ecb − 1| ≤ 5 %` (same currency: equal amounts).
2. **Given** the proposal **When** accepted **Then** one `transfer` link CHF → SEK exists, both rows derive `no_document` while their journal entries are untouched (`no_document_needed`, `categorised_by` as before — rules still apply to them, D44), the CHF entry reads an implied rate of 11.887 (derived from the link, journal T005 / F86) while `amount_base` and `rate` (ECB) are unchanged; audited.
3. **Given** `fixtures/nordea-savings-year.csv` (+50 000 SEK) and a −50 000 SEK row on the SEK account two days earlier **When** candidates are computed **Then** the pair is proposed at rate 1.
4. **Given** a row already in a transfer link **When** candidates are asked **Then** none; **Given** an accepted pair **When** the link is removed **Then** both rows are exactly as before the pair (facts and derived state; only the set-once bank implicit rate stays).

---

### User Story 4 - What is open, categorised, proven (Priority: P2)

The workbench lists every transaction with its account, counterparty, amount, balance, category, partner and a derived state — *Open*, *Partially linked*, *Linked*, *No document needed* — with the Excel-style filters (account, state, category, partner, dates, amounts, import). The side panel shows the raw columns, the journal entry (category, partner, note, *no document needed*), the links and the transfer proposal. Nothing about the transaction itself can be edited; the journal entry can.

**Acceptance Scenarios**:

1. **Given** a transaction with no links and `no_document_needed = false` **Then** `open`; with `0 < Σ allocations < |amount|` **Then** `partial`; with `Σ allocations ≥ |amount| − tolerance` or a `transfer` link **Then** `linked`; with `no_document_needed = true` **Then** `no_document` whatever the links.
2. **Given** the list filtered by account *Plusgirokonto CHF* **When** the category filter opens **Then** its distinct values are those of the CHF rows only (Excel semantics), labelled `657 · Bankkostnader`.
3. **Given** a transaction **When** the owner sets a category, a partner, a note or the flag in the side panel **Then** the journal entry is updated (`categorised_by = manual`), audited; the raw transaction is byte-for-byte what the CSV said (a direct SQL update of `amount` is refused by the database).
4. **Given** the list **When** the footer is read **Then** it shows the row count and the sum of `amount` and `amount_base` of the filtered set.
5. **Given** the accountant **When** she opens the workbench **Then** she reads everything and can change nothing.

---

### User Story 5 - Transactions are linkable (Priority: P2)

A bank transaction can justify an invoice, a document, a supplier invoice or an expense (`justifies`, with an allocation), pair with another transaction (`transfer`), or settle an owner reimbursement (`settles`). The allocations from one transaction never exceed its amount.

**Acceptance Scenarios**:

1. **Given** a −1 297.20 CHF transaction and an issued invoice of 1 297.20 CHF **When** a `justifies` link with allocation 1 297.20 CHF is created **Then** the invoice derives `paid` and the transaction `linked`.
2. **Given** that transaction **When** a second allocation of 1.00 CHF is attempted from it **Then** refused: *Allocations from this transaction (1 297.20) would exceed its amount* — service check and database invariant.
3. **Given** a journal entry of a manual kind **When** it is the `from` of a `justifies` link **Then** the same allocation rule applies to its amount.

---

### Edge Cases

- Thousands separator with a space (`-1 500,00`) — accepted (v1 test); `1.500,00` too (v2).
- `Date` and `Booking date` are both accepted as the first header; any other first header, delimiter or column count → not a Nordea export.
- A `Currency` cell empty on a row → the account currency (v2 default was SEK; v3 uses the account's).
- Formula-looking cells (`=`, `+`, `@`, `-` not followed by a digit) are imported verbatim and reported as warnings, never dropped.
- The CSV is stored even when every row was a duplicate (the package needs the file of the period); an import with 0 imported rows is still a record.
- Two accounts with the same Plusgiro number and different currencies (the owner's real setup): the filename pre-selects the number, the first row's currency picks the account.
- Encoding: ISO-8859-1 (Nordea); a UTF-8 BOM is stripped.
- Rows are inserted in file order; `row_index` is provenance only and never part of any key.
- Deleting a bank account with imports: refused (RESTRICT) — imports are deleted first, each one checked for links.
- The balance shown on the account is the balance of the latest booking date that has one; no stored running balance.
- An import into the wrong account: delete the import (US1-9) and import again.
- Rules never set a status, never create links, never touch an entry categorised by hand.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `bank_accounts.role ∈ main | savings` (default `main`); the three seeded accounts get their role. The role drives the accountant package rhythm (monthly vs yearly, D13/D31) — nothing else in banking.
- **FR-002** `bank_imports`: account, file name, the stored CSV document (validated UUID), `record_count / imported_count / duplicate_count / error_count`, `errors` (JSON list of `Row N: …`), `period_from / period_to` (min/max booking date of the file), `imported_at`, creator. Deleting an import deletes its transactions and their journal entries unless any transaction is linked (trigger + service).
- **FR-003** `bank_transactions`: account, import, `booking_date`, `amount` (signed, 2 dp), `currency` (= account currency), `balance?`, the six raw text columns verbatim (`sender, recipient, name, additional_details, message, own_notes`), `description`, `reference?` (the `Message` column verbatim), `counterparty_key`, `dedup_hash` (sha256 hex), `occurrence` (0-based within the file's identical rows), `row_index`. Unique `(bank_account_id, dedup_hash, occurrence)`. **Immutable**: a database trigger refuses every UPDATE; DELETE only through the import's deletion and only when unlinked (`block_delete_when_linked('bank_transaction')`). RLS.
- **FR-004** The parser (`csv-parser.ts`, v2) changes exactly three things (D25): the hash drops the row index and the description and takes the raw text columns (`date | amount | currency | sender | recipient | name | additional details | message`); the first header accepts `Date` as well as `Booking date` and the header row is validated against the format's labels (else *Not a Nordea export*); a space thousands separator is accepted. The parser also returns the raw columns by field, the in-file `occurrence`, and derives `counterparty_key`: `name`, else `additional details` with the card prefix (`Kortköp yymmdd`, `KORT KOP`) removed, else `message`, else `sender` / `recipient`; upper-cased, trailing 4-digit card suffix removed, whitespace collapsed.
- **FR-005** Import (`importCsv`): the owner names the account; the file's currency must equal the account's (else refused, nothing written); parse; dedup per account on `(hash, occurrence)`; insert the new transactions; store the CSV as a document (business key `Bank_{account alias}_{period_from}_{period_to}.csv`, no OCR, read-only like a generated document); create one journal entry per new transaction through the journal module (SEK base: `same_currency` rate 1 for SEK accounts, ECB of the booking date for CHF — refused when no rate exists); apply the active rules to the new entries; write the import record; audit. All in one transaction.
- **FR-006** Account pre-selection from the filename: number = first `\d+[\s-]+\d+[\s-]+\d+[\s-]*\d*` match (spaces collapsed), currency = the first data row's `Currency`; the match is a hint for the dialog, never a creation.
- **FR-007** `categorisation_rules`: `name` (unique per tenant), `description?`, `match_type ∈ contains | starts_with | ends_with | exact | regex`, `match_pattern`, `match_field ∈ counterparty_key | name | details | message | sender | recipient | all`, `bas_code?` (must exist in `bas_categories`), `partner_id?` (validated through partners), `no_document_needed`, `priority` 0–999 (default 100), `is_active`, `source ∈ manual | learned`, `hit_count`, `last_hit_at?`. A rule must set at least one of category, partner, flag. Regex compiled on save (refused when invalid).
- **FR-008** Matching (pure): active rules ordered `priority desc, length(pattern) desc, created_at desc`; first hit wins; case-insensitive; `all` joins `name, details, message, sender, recipient` with spaces; an invalid regex never matches. Applying a hit: category (rule's, else the partner's default), partner (only when the entry has none), `no_document_needed = rule.flag || entry.flag`, `categorised_by = rule`, `rule_id`; the rule's counters move. Candidates are entries with `categorised_by IS NULL`.
- **FR-009** Rules run at import on the new entries and on demand (`applyRules({dryRun})` over the tenant's uncategorised bank entries, preview ≤ 50); `testRule(pattern, type, field)` returns `matches / tested` over the newest 500 uncategorised transactions; *create rule from transaction* pre-fills from the entry (FR-009 → `source = learned`) and applies to that entry.
- **FR-010** Transfer pairs (pure detection + service): candidates for transaction `a` are transactions `b` on another own account, opposite sign, `|date(b) − date(a)| ≤ 2 days`, not already in a `transfer` link; same currency → equal absolute amounts; different currencies → `implied = |SEK| / |CHF|` within 5 % of the ECB rate of `a`'s booking date; text hints (`CHANGE`, `CHFSEK`, `SEKCHF`, `ÖVERFÖRING`, the other account's number in `recipient`/`sender`) raise the confidence shown, never required. Accepting: one `transfer` link (linking module) and nothing else on the legs (D44), the foreign-currency entry's implied rate derived from that link on read (its `rate` / `amount_base` stay ECB); audited; refused when either side is already paired.
- **FR-011** Derived transaction state (read model over `links` + the journal flag): `no_document` when the entry's flag is set or a `transfer` link exists (D44); else `linked` when `Σ allocations ≥ |amount| − tolerance` (`settlementTolerance`, D25); else `partial` when `Σ > 0`; else `open`. Never stored.
- **FR-012** Linkables: `bank_transaction` (label `2026-07-08 · −20 000.00 CHF · CHANGE CHFSEK`, amount `|amount|`, currency) and `journal_entry` (manual entries, same shape). The linking service enforces, for allocating kinds, `Σ allocations from one source ≤ its amount` when the source's summary carries an amount (service check; the database side is a deferred-constraint trigger on `links`).
- **FR-013** Lists on the kernel DataTable: transactions (`bookingDate, accountId, description, counterpartyKey, amount, currency, amountBase, balance, basCode, partnerId, partnerName, state, noDocumentNeeded, note, reference, importId, ownNotes, createdAt` — `state`, `partnerName`, `basCode`, `noDocumentNeeded`, `note`, `amountBase` are derived/joined from links and journal; distinct values and date hierarchy server-side with Excel semantics; sums on `amount` and `amountBase`; search on description, counterparty, message, details, reference, note); imports (account, file, period, counts, date); rules (name, pattern, type, field, category, partner, flag, priority, active, source, hits, last hit).
- **FR-014** Pages (part 2): `/banking` — `ListPage` + `TransactionTable` + side panel (raw columns, journal form, links, transfer proposal, *Create rule from this*) + *Import* dialog (file → pre-selected account → summary); `/banking/imports` — list, delete; `/banking/rules` — list, create / edit / deactivate dialog (regex behind *advanced*), *Test* count, *Apply* with dry run. Nav *Banking* for owner and accountant (reads), *Journal* likewise (journal spec). Strings `banking.*` en + fr.
- **FR-015** Every write is audited; the owner writes, the accountant reads (`can(read, bank_transaction)`).
- **FR-016** Seeds: the three accounts with roles (dev seed); the Nordea format gains the `Date` header alias (migration); the two default rules of US2-8 are created by the import service on a tenant's **first import** when the tenant has no rule at all (no tenancy hook — the kernel never imports a module), and by the dev seed.
- **FR-017** (F65) Once an account has an import, its number and currency are locked: an update changing either is refused (`BUSINESS_RULE_VIOLATION`, `details.imports`); alias, IBAN / BIC, format and role still change. The settings tab disables the two fields.

### Key Entities

- **Bank account** (exists): + `role`.
- **Bank import**: provenance of one file: account, file, document, counts, errors, period.
- **Bank transaction**: one CSV row, immutable; raw columns, derived text (`description`, `reference`, `counterparty_key`), dedup key.
- **Categorisation rule**: a text match → category / partner / flag, with priority and counters; `manual` or `learned`.
- **Journal entry** (journal module): the financial fact of a transaction or a manual entry — see `specs/journal/spec.md`.
- **Transfer proposal** (read model): `a`, `b`, `implied`, `ecb`, `deviation`, `hints`, `confidence`.
- **Derived state** (read model): `open | partial | linked | no_document`.

## Success Criteria *(mandatory)*

- **SC-001** The July sample imports in one action with 0 errors, every row categorised by the seeded rules that apply, and a second import of the same file adds nothing — verified by the DB tests on the fixture.
- **SC-002** The dedup property holds under 200 random files: re-importing any file yields 0 new rows; importing a strict superset yields exactly the extra rows; identical rows in one file are all kept.
- **SC-003** Every `testPatternCases` row of `fixtures/categorisation-rules-sample.json` passes; an invalid regex rule never throws anywhere.
- **SC-004** The fixture transfer pair is proposed with implied 11.887 and accepted into one link, both rows *no document needed* by that link; a pair outside 5 % of ECB is not proposed.
- **SC-005** No bank transaction can be changed by any route — a direct SQL update of `amount` is refused; a linked transaction cannot be deleted.
- **SC-006** `Σ allocations from one transaction ≤ |amount|` holds under the property test and in the database.

## Assumptions

- The scored suggestions (transaction ↔ invoice / document / expense), the inbox with its keyboard, bulk apply and the short-payment tolerance writing *bank fees* belong to the **linking UI** feature (next after expenses and supplier invoices, per the owner's order); this feature delivers the transfer pairs only, since they need no other module.
- Three accounts, one tenant: no account management beyond the existing Bank accounts settings tab (+ the role select).
- The savings yearly rule (`role = savings`) is consumed by the package builder (exports); banking only records the role.
- Recurring journal templates (salary, Skatteverket) are **rules** with `no_document_needed` — the movement is always a bank row; manual journal entries exist for facts that never touch the bank (journal spec). No template engine.
- BAS codes are the 3-digit groups of `bas_categories` (`657` bank costs, `831` interest income, `654` IT services); the accountant confirms the owner's mapping — the seed names only the two universal ones.
- v2's `BankFormat` library stays app-level; no format editing UI. The Nordea format is the only one.
- `Own notes` (what the owner typed in Nordea) is kept verbatim and searchable; it does not pre-fill the journal note.
