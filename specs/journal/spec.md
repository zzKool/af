# Feature Specification: Journal — the categorised ledger of financial facts

**Feature Branch**: built with banking — `feat/banking-import` (model, service, queries) · `feat/banking-pages` (the ledger page)

**Created**: 2026-10-20

**Status**: Ready for planning (D1, D2, D3; feature-inventory §3.12; harvest `specs/banking/harvest.md` §3.2, §8.1)

**Input**: "Every bank transaction is a financial fact with a BAS category, a partner, a note, a flag *no document needed*, and its SEK base with the rate that produced it. A few facts never touch the bank (a prepaid service spread over the year, a forfait) and are typed by hand. The accountant books; the journal is the chronological, filterable list she and the owner read."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every bank row is a journal entry (Priority: P1)

The banking import creates one entry per new transaction: date, description, counterparty key, amount in the account currency, the SEK base and the rate that produced it (`same_currency` 1 for SEK, ECB of the booking date for CHF with `ecb_daily` / `ecb_nearest` and the rate date). The money facts are written once; the category, partner, note and flag are the owner's and change freely.

**Acceptance Scenarios**:

1. **Given** a CHF transaction of −20 000.00 on 2026-07-08 and ECB CHF→SEK 11.90 that day **When** the entry is created **Then** `amount = −20000.00`, `currency = CHF`, `amount_base = −238000.00`, `rate = 11.900000`, `rate_source = ecb_daily`, `rate_date = 2026-07-08`; **Given** no rate on the day but one on 2026-07-07 **Then** `ecb_nearest` with `rate_date = 2026-07-07`.
2. **Given** an entry **When** `amount`, `currency`, `amount_base`, `rate`, `rate_source`, `rate_date`, `entry_date`, `source_type` or `source_id` is updated by any route **Then** refused by the database (trigger); `bas_code`, `partner_id`, `note`, `no_document_needed`, `categorised_by`, `rule_id` are the mutable fields.
3. **Given** a bank transaction **When** its import is deleted **Then** its entry goes with it (banking calls the journal); a manual entry is deleted by hand only.
4. **Given** two creations for the same source **Then** the second is refused (unique on `(source_type, source_id)`).

---

### User Story 2 - Categorise (Priority: P1)

The owner sets the BAS category (from the tenant's active set, favourites first, shown as `657 · Bankkostnader`), the partner, a note and *no document needed*; choosing a partner proposes its default category when the entry has none. Rules do the same through the same service with `categorised_by = rule`; a hand-set value is never overwritten by a rule.

**Acceptance Scenarios**:

1. **Given** an uncategorised entry **When** the owner sets category 654 and partner OpenAI **Then** stored with `categorised_by = manual`, audited (old / new).
2. **Given** an entry categorised by a rule **When** the owner changes the category **Then** `categorised_by = manual`, `rule_id` cleared; a later rule run skips it.
3. **Given** an unknown BAS code or a partner of another tenant **When** saved **Then** refused.
4. **Given** the accountant **When** she tries to categorise **Then** refused (reads only).

---

### User Story 3 - Manual entries (Priority: P2)

*Journal → New entry*: date, description, amount and currency (SEK base computed with the ECB rate of the date, or a rate typed by hand with `rate_source = manual`), category, partner, note. Used for the prepaid / forfait facts that have no bank row; they can be justified by a document like any transaction.

**Acceptance Scenarios**:

1. **Given** a manual entry of 1 200.00 EUR on 2026-03-01 **When** created **Then** base from the ECB EUR→SEK rate of the day; **Given** a typed rate 11.25 **Then** `rate_source = manual`, `amount_base = 13500.00`.
2. **Given** a manual entry **When** edited **Then** only the mutable fields change (US1-2); to fix the amount the owner deletes it (refused while linked) and creates another.

---

### User Story 4 - The ledger (Priority: P2)

`/journal` lists every entry on the DataTable: date, source (bank account alias or *manual*), description, counterparty, category, partner, amount, currency, base, rate, rate source, flag, note, links state. Excel-style filters (period, currency, category, partner, source, flag), sums of `amount_base` on the filtered set, search on description / counterparty / note.

**Acceptance Scenarios**:

1. **Given** entries from the SEK and CHF accounts and one manual **When** filtered on 2026-07 **Then** the footer sums `amount_base` of those rows; the category filter shows only the categories present in July.
2. **Given** the accountant **When** she opens the ledger **Then** everything is readable, nothing editable.

### Edge Cases

- A bank entry's `description` and `counterparty_key` are copies taken at import (the journal never reads banking); they are immutable like the money facts.
- the bank implicit rate is informational and derived from the `transfer` link, never stored (T005, F86) (shown beside the ECB rate, D3 / bas-accounting skill); it never replaces `rate`.
- Entries are never "posted": no debit/credit, no fiscal-year lock (D1). The accountant package reads them.
- Manual entries in SEK: `rate_source = same_currency`.

## Requirements *(mandatory)*

- **FR-001** `journal_entries`: `source_type ∈ bank_transaction | manual`, `source_id?` (validated UUID, unique with the type when set), `entry_date`, `description`, `counterparty_key?`, `amount` (signed, 2 dp), `currency`, `amount_base` (2 dp), `rate` (6 dp), `rate_source ∈ same_currency | ecb_daily | ecb_nearest | manual`, `rate_date?`, `bas_code?` (exists in `bas_categories`), `partner_id?`, `note?`, `no_document_needed`, `categorised_by ∈ manual | rule | partner_default` (null = uncategorised), `rule_id?`, template columns. RLS; indexes on `(tenant, entry_date)`, `(tenant, bas_code)`, `(tenant, partner_id)`, `(tenant, source_type, source_id)`.
- **FR-002** Immutability of the money facts by trigger `journal_entries_lock_money` (refuses changes to the columns of US1-2); `block_delete_when_linked('journal_entry')`.
- **FR-003** Service: `createBankEntries(tx, caller, audit, rows[])` (batch; base through `rates.rateToBase`; refused when a rate is missing), `createManualEntry`, `categorise(id, {basCode?, partnerId?, note?, noDocumentNeeded?, by, ruleId?})` with the never-overwrite rules, `deleteBySource(sourceType, sourceIds[])`, `deleteManualEntry`. Reads: `entriesForSources(sourceType, ids)` (the banking workbench joins on it), `listJournalEntries` (ListQuery), `distinctJournalValues`, `journalDateHierarchy`, `getJournalEntry`.
- **FR-004** `journal_entry` registers as linkable (label `2026-03-01 · 1 200.00 EUR · Prepaid licence`, amount `|amount|`, currency) — only manual entries are offered as link sources; bank entries are reached through their transaction.
- **FR-005** Every write audited; the owner writes, the accountant reads (`can(read, journal_entry)` — new resource in `can.ts`).
- **FR-006** Page `/journal` (part 2): `ListPage` + `JournalTable` + *New entry* dialog + side panel with the categorise form (shared component with the banking workbench). Nav *Journal* for owner and accountant. Strings `journal.*` en + fr.

## Success Criteria *(mandatory)*

- **SC-001** Base amounts of the fixture rows match `amount × rate` half-up to 2 dp for every rate source; a 200-run property test holds `sign(amount_base) = sign(amount)` and `|amount_base| = round(|amount| × rate, 2)`.
- **SC-002** A direct SQL update of `amount_base` is refused; a linked entry cannot be deleted.
- **SC-003** A rule never overwrites a hand-set category or partner (DB test).

## Assumptions

- No fiscal years, no VAT codes per entry, no posting (D1). The Swiss / Swedish VAT views are read models in exports.
- Recurring facts (salary, Skatteverket) are bank rows categorised by rules — no template table.
- `bas_code` is the 3-digit BAS group (the `bas_categories` natural key); the 4-digit account is the accountant's.
