# Feature Specification: One transaction table — the bank row carries its own facts (F113, D59)

**Feature Branch**: `feat/banking-one-table` (PR A), `feat/banking-one-table-drop` (PR B), `feat/package-row-category` (PR C)

**Created**: 2026-10-27

**Status**: Approved by the owner 2026-10-27 · PR A built (`feat/banking-one-table`) · PR B and PR C after B1 (D65)

**Input**: D59 (the owner, 2026-10-27, [[audit-2026-10-27]] §2.3): "`journal_entries` duplicates `bank_transactions` field by field and bolts on the owner's facts. Put the base, rate, BAS, partner, note and the no-proof flag on the bank row; the journal becomes a read of the same rows; manual journal entries go — periodisation is the accountant's (D1)."

## Why (the audit, three auditors independently)

```
today      bank_transactions ──(source_type, source_id — a join without a key)──► journal_entries
           date · amount · currency · text ×2            + amount_base · rate · bas_code · partner_id · note · no_document_needed
           two linkable identities for one fact (links from bank_transaction AND from journal_entry)
           /banking and /journal: the same list twice; rowsToJustifyCount loads every row + link + entry per page
           journal → linking → banking → journal, a cycle behind `await import` (implicit-rate.ts)
           the accountant's sheet prints basCode null on a row whose proof carries 6540 (audit B2)

after      bank_transactions: date · amount · currency · text · amount_base · rate · rate_source · rate_date
                               · bas_code · partner_id · note · no_document_needed · categorised_by · rule_id
           one linkable identity (bank_transaction); the journal is a read of the rows; no manual entries
```

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The row is the fact (Priority: P1)

The import writes each row **with** its SEK base and rate (`same_currency` 1 for SEK; ECB of the booking date for CHF, `ecb_daily` / `ecb_nearest` with the rate date — the rule the journal applied, now in banking). The money facts are immutable from the first write (a trigger, as `journal_entries` had); the owner's facts — BAS, partner, note, *no document needed* — change freely through `banking.categorise` (the journal's `categorise` moved, same rules: a rule's value never overwrites a hand-set one, `categorised_by` and `rule_id` as today).

**Acceptance Scenarios**:

1. **Given** a CHF row of −20 000.00 on 2026-07-08 and ECB 11.90 **When** imported **Then** the row carries `amount_base = −238000.00`, `rate = 11.900000`, `rate_source = ecb_daily`, `rate_date = 2026-07-08`; no `journal_entries` row is created.
2. **Given** a row **When** `amount`, `currency`, `booking_date`, `amount_base`, `rate`, `rate_source` or `rate_date` is updated by any route **Then** refused by the database (`bank_transactions_lock_facts`); `bas_code`, `partner_id`, `note`, `no_document_needed`, `categorised_by`, `rule_id` change.
3. **Given** a rule hits on import **Then** the row's `bas_code` / `partner_id` are set with `categorised_by = rule`, `rule_id`; the owner's later change sets `manual` and clears `rule_id` — exactly the journal's US2.
4. **Given** the accountant **Then** reads, never categorises.

### User Story 2 - The existing books move once (Priority: P1)

One migration: the new columns on `bank_transactions`; every bank-sourced `journal_entries` row copied onto its row (base, rate, rate source, rate date, BAS, partner, note, flag, categorised_by, rule_id); every `links` row with `from_type = 'journal_entry'` re-pointed to `bank_transaction` + the entry's `source_id` (duplicates with an existing bank-row link of the same kind and target dropped — the same fact); the audit trail kept: the entries' `update` rows are **appended** onto their rows' own trail (`entity_type = bank_transaction`, same `created_at`, audit rows are append-only), so the row's History reads one trail and no map table is needed; the old `journal_entry` rows stay as they are. **Manual entries**: the migration refuses to run while any exist (`RAISE EXCEPTION` listing their dates and descriptions) — the owner deletes them first (none are expected: the Excel history is not imported, D65; a prepaid-service fact is the accountant's periodisation, D1).

**Acceptance Scenarios**:

1. **Given** the seed's rows, entries and links **When** migrated **Then** every row carries its entry's facts; `SELECT count(*) FROM links WHERE from_type = 'journal_entry'` is 0; every former `justifies` from an entry is a `justifies` from its row; the package of the seed's month is byte-identical before and after (the golden, `generators.pure.test.ts`) once PR C lands — until then the summary's BAS column is the same.
2. **Given** one manual entry **When** migrated **Then** the migration fails with its date and description, nothing changed.
3. **Given** the migration ran **Then** `journal_entries` still exists, read by nothing (PR B drops it after one real month on the box, D65).

### User Story 3 - The ledger is the transactions list (Priority: P2)

`/journal` goes; the nav item goes (one PR, the nav file alone). What the Journal page showed that Banking did not — the *Source* tag (`Manual` is gone), the BAS / partner / note / flag columns — Banking's DataTable shows (Category and Partner already; Note and *No doc* added as hidden columns the owner can turn on). The accountant's read is the same page, read-only as today. The linking inbox, the partner 360°, the package, the months grid and the open-work count read the row.

**Acceptance Scenarios**:

1. **Given** the owner on `/banking` **Then** the columns of the old ledger are available (Category, Partner, Note shown; *No document*, *Categorised by*, the base, rate and rate source as hidden columns); the footer sums `amount_base`; the category filter shows the categories present.
2. **Given** `/journal` **Then** 404; `nav.journal` gone from the dictionaries; `kernel/nav` tests updated.

### User Story 4 - Linked means categorised (Priority: P2, PR C — audit B2, D58)

A row with no typed BAS that `justifies` an expense or a supplier invoice shows that entity's BAS (pro rata by allocation when several) and that entity's partner — on the banking list, the panel, the package's bank sheet and the SCB / VAT reads. Derived on read; a typed value wins; never written back.

**Acceptance Scenarios**:

1. **Given** a row justifying a 6540 supplier invoice, no category typed **Then** the list and the package print 6540 and the supplier; the audit trail shows no categorisation.
2. **Given** the owner types 6530 on that row **Then** 6530 wins everywhere.

### Edge Cases

- A row justified by two entities with different BAS: the list shows the larger allocation's code with a *mixed* tag; the package prints one line per allocation (it already prints *Related documents*; the BAS column follows the same split).
- Transfer pairs (D44): both rows keep `no_document_needed` as the transfer rule sets it today; the implied rate (`implicit-rate.ts`) moves to banking, read from the `transfer` link as now.
- The rules engine (`banking/rules.ts`) writes the row directly — no more `journal.categorise` round trip; one service, one audit entry.
- `rate_source = bank` stays impossible on a row (CHECK) — the row *is* the bank.

## Requirements *(mandatory)*

- **FR-001** Schema (PR A, the migration alone touches it): `bank_transactions` + `amount_base DECIMAL(15,2) NOT NULL`, `rate DECIMAL(18,6) NOT NULL`, `rate_source rate_source NOT NULL CHECK (rate_source <> 'bank')`, `rate_date DATE`, `bas_code VARCHAR(4)`, `partner_id UUID` (a composite FK to `partners`, D63), `note TEXT`, `no_document_needed BOOLEAN NOT NULL DEFAULT false`, `categorised_by journal_categorised_by`, `rule_id UUID`; indexes on `(tenant_id, bas_code)`, `(tenant_id, partner_id)`, `(tenant_id, categorised_by)`; trigger `bank_transactions_lock_facts`; the data copy, the link re-pointing, the manual-entry guard, the audit-trail append. The columns are added NOT NULL with the copy in the same transaction (a row without an entry — none expected — fails the migration by name).
- **FR-002** `banking` absorbs the journal's write path and reads: `categorise`, `resolveRate` / the base rule (`facts.ts`), `entriesForSources` → `transactionFacts` (the row carries the facts), `withImplicitRates` (`implicit-rate.ts`, apart from `facts.ts` so the actions' load-time schema read never meets linking's registry — the cycle the journal hid behind `await import`), `entryHistory` → `transactionHistory` reads the row's one trail. `modules/journal` is deleted in PR A (nothing re-exports it): every consumer (`expenses`, `supplier-invoices`, `linking`, `package`, `subscriptions`, the `partners` page, the three banking pages) switches to `banking`'s read in the same PR.
- **FR-003** `linking`: `journal_entry` leaves `LinkableType`, the kinds matrix, hrefs, scoring; the registry has one identity for a row. Links data migrated (FR-001).
- **FR-004** The Months grid, `open-work.ts`, `rowsToJustifyCount` and the dashboard read `bank_transactions` + `links` only — one query each, no entry join (audit D8 rides here: the layout's count becomes a SQL aggregate).
- **FR-005** PR B (after one real month, D65): drop `journal_entries`, `journal_source` and the `JournalEntry` model; `specs/journal` marked superseded by this spec. (`modules/journal`, `/journal`, `nav.journal` and the journal's i18n keys went in PR A — the nav file and the dictionaries in the same PR, one schema PR at a time.)
- **FR-006** PR C: the derived category / partner (US4) as a read in `banking` (`effectiveCategory(row, links)`), used by the list, the panel, the package and the declarations' reads; `docs/banking.md` and `docs/accountant-package.md` say so; D58 recorded as applied.
- **FR-007** Tests: the migration on the seed (US2-1, in `prisma/migrations/*.test.ts` or `banking/one-table.test.ts`: counts before / after, the links re-pointed, the golden); the lock trigger hit directly; `categorise` on the row; the e2e of `/banking` categorising a row and the inbox linking it, unchanged in behaviour; `kernel/guards` green (the cycle is gone — `implicit-rate.ts` imports nothing dynamically).

## Success Criteria *(mandatory)*

- **SC-001** After PR A on the seed: every `bank_transactions` row has its base and rate; `journal_entries` is read by no code path (`grep -rn "journalEntry\b" src/modules` empty); no `await import` in banking.
- **SC-002** The banking e2e journeys (import, categorise, link, months, inbox, rules) pass unchanged.
- **SC-003** The package golden is identical before and after PR A (the BAS column reads the row's typed value, exactly what the entry held).
- **SC-004** PR C: the package of a month with an uncategorised row justified by a 6540 supplier invoice prints 6540 (a new golden, captured once).
- **SC-005** `/journal` is gone (PR A); the sidebar has one entry fewer; the accountant's read works on `/banking`.

## Assumptions

- No manual journal entries exist on the box (the owner confirms before PR A deploys; the migration refuses otherwise).
- The accountant never had the Journal page (F03 parked); nothing of his changes.
- Rollback of PR A = restore the snapshot taken before the deploy ([[deployment]] *Update*); the untouched `journal_entries` table is a second safety net until PR B.

## Out of scope

- The Justify panel (F97) and the one engine (F116) — they land on the row this spec produces.
- Splitting a row across categories (the audit's A4 note): one BAS per row stays; the derived *mixed* tag covers the justified case.
