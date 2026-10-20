# Journal — the categorised ledger of financial facts

Module `src/modules/journal` · schema `prisma/schema/journal.prisma` · migration `20261021100000_add_banking_import_and_journal` · spec `specs/journal/spec.md` · decisions D1, D2, D3. Part 1: model, service, queries, linkable. Part 2: the `/journal` page and the categorise form shared with the banking workbench.

> One entry per bank transaction (created by the [[banking]] import) or typed by hand. The money facts — amount, currency, SEK base, rate, rate source, date, description — are written once; the owner's facts — BAS category, partner, note, *no document needed* — change freely and never get overwritten by a rule. Not a ledger: no debit / credit, no posting, no fiscal year. The accountant books; the journal is what she and the owner read.

## Model

```
journal_entries   source_type ∈ bank_transaction | manual · source_id? (the transaction id, validated UUID; unique per source)
                  entry_date · description · counterparty_key?        (copied at import — the journal never reads banking)
                  amount (signed) · currency · amount_base (SEK, 2 dp) · rate (6 dp) · rate_source ∈ same_currency | ecb_daily | ecb_nearest | manual · rate_date?
                  bank_implicit_rate? (the accepted transfer pair's SEK ÷ CHF — informational, set once, never replaces `rate`)
                  bas_code? (bas_categories.code, 3 digits) · partner_id? · note? · no_document_needed
                  categorised_by ∈ manual | rule | partner_default | null · rule_id?
```

Trigger `journal_entries_lock_money`: amount, currency, amount_base, rate, rate_source, rate_date, entry_date, source, description, counterparty_key never change; `bank_implicit_rate` only NULL → value. `block_delete_when_linked('journal_entry')`. RLS.

## Service — `journal.ts`

- `baseAmount(amount, rate)` (pure): `round(amount × rate, 2)` half-up, never `-0`; property-tested.
- `resolveRate(tx, date, currency)` / internal `baseFor`: SEK → 1 `same_currency`; else `rates.rateToBase` (ECB of the date, `ecb_nearest` with the actual `rate_date` when the day has none); **refused** when no rate exists — the banking import pre-checks every date before writing.
- `createBankEntries(tx, caller, audit, rows[])`: batch, all or nothing, audited; `createManualEntry` (ECB of the date, or a typed rate → `manual`; SEK must be 1).
- `categorise(tx, caller, audit, id, facts, {by, ruleId})`: by hand → written as given, `categorised_by = manual`, `rule_id` cleared; by a rule → category only when none, partner only when none, flag OR-ed, and an entry categorised by hand is returned unchanged. BAS code through `settings.getBasCategory`, partner through `partners.getPartner`.
- `setBankImplicitRate` (once), `deleteBySource` (the banking import's delete), `deleteManualEntry` (bank entries are never deleted by hand; linked entries refused by the trigger).

## Reads — `queries.ts`

`entriesForSources(tx, type, ids)` → `Map<sourceId, entry>` (the banking workbench joins on it) · `getJournalEntry` · `JOURNAL_COLUMNS` + `listJournalEntries` / `distinctJournalValues` / `journalDateHierarchy` — two-step list (stored filters in SQL, `partnerName` / `basLabel` joined, derived filters / search / sort / page in memory through `kernel/list-query/memory`), sums of `amount_base` on the filtered set.

## Surface

- `index.ts`: service, schemas, queries, actions, `journalEntryLinkable`, DTOs.
- `ui.ts`: actions + types.
- Actions: reads on `authedAction` + `can(read, journal_entry)`; `createManualEntryAction`, `categoriseEntryAction`, `deleteManualEntryAction` on `ownerAction`.
- Linkable: manual entries carry `|amount|` and can be the source of a `justifies` link; bank entries are reached through their transaction.

## Page (part 2)

`/journal` — `ListPage` + `JournalTable` (DataTable on `JOURNAL_COLUMNS`: source, description, category, partner, amount in its currency, SEK base with the footer sum, flag, note; rate / rate source / bank rate / categorised-by hidden by default). A row opens the side panel with the `CategoriseForm` (category from the tenant's active BAS set — favourites first, `657 · Bankkostnader (alias)` — partner, note, *no document needed*; saved on change) and, for manual entries, *Delete entry*. *New entry* (`ManualEntryDialog`): date, description, signed amount, currency, optional typed rate, category, partner, note. `options.ts` (`categoryOptions`, `partnerOptions`) feeds these lists server-side. Nav: *Journal* for owner and accountant (reads). Strings `journal.*` en + fr.

## Tests

`base.pure.test.ts` (fixture rows + 200-run property) · `journal.test.ts` (DB): base at ECB / nearest / 1, the lock trigger column by column, one entry per source, categorise by hand vs by rule (never overwritten), manual entries (ECB, typed rate, refusals, delete while linked), the ledger (sums, Excel-semantics distinct values, search on the partner name, RLS).

Related: [[banking]], [[linking]], [[rates]], [[bas-categories]], [[feature-inventory]] §3.12, the `bas-accounting` skill.
