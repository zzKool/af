# BAS Categories

Swedish BAS kontoplan (chart of accounts) reference data and tenant customization.

## Overview

BAS categories are the **accounts at four digits** (D68, F148 — 2026-11-08) of the official Swedish [[BAS 2026|https://bas.se]] chart: ~470 main accounts `NNN0` and ~810 sub-accounts `NNN1`–`NNN9` (`kind`, `parent_code`), each in one of BAS's 70 two-digit account groups (`bas_groups`: `65` Other external services). Until 2026-11-08 they were the ~472 three-digit main accounts without their 0 (`654`). They serve as shared reference data for all tenants — no tenant owns or modifies the canonical BAS entries.

Tenants customize their experience through `tenant_bas_preferences`, which stores per-tenant activation, favorites, short codes, and translations.

## Architectural Patterns

### No-RLS Shared Data

`bas_categories` is the first table that **does not use RLS**:

- No `tenant_id` column — data is identical for every tenant
- SELECT-only GRANT to app role — no writes permitted
- Immutability enforced via PostgreSQL RULEs (`DO INSTEAD NOTHING` for INSERT/UPDATE/DELETE)
- Non-sensitive, publicly available data from bas.se

Only `tenant_bas_preferences` has full RLS with tenant isolation policy.

### Natural Key

`bas_categories` uses a **natural key** (`code` as `@id`) instead of a UUID:

- Four-digit BAS accounts (e.g., "1930", "6540") are globally unique and stable
- Simplifies queries — no JOIN needed to filter by code
- `tenant_bas_preferences.bas_code` references `bas_categories.code` directly
- `AuditLog.entityId` stores the natural key string (e.g., "6540"; audit lines written before D68 keep "654")

### Sparse Preferences

Not every BAS category needs a preference row. `tenant_bas_preferences` rows are created on-demand:

- Activating a category creates a preference row (or updates `isFavorite`)
- Deactivating deletes the preference row entirely
- Categories without a preference row are "available but inactive"
- Other modules ask `isBasActivated(tx, code)` (settings' `queries.ts`) instead of reading `tenant_bas_preferences` ([[lessons]] audit 25)
- This keeps the table small (~30-50 rows per tenant vs ~472 categories)

## Yearly Update Process

The BAS standard is updated annually. To update:

1. Download the new XLSX files from bas.se (the Swedish chart and the English translation) into `prisma/data/` — they are licensed: gitignored, never committed
2. Run `node prisma/data/parse-bas.mjs > /tmp/bas_chart.sql` — INSERTs for `bas_groups` and `bas_categories` (`parseChart`, tested on invented rows in `src/modules/settings/bas-chart-parse.pure.test.ts`)
3. A new migration: the rules step aside (`DROP RULE`), the new rows go in, renamed or removed accounts are mapped on every column that keeps a code (the D68 migration `20261108120000_bas_four_digit` is the pattern: a guard that names any stored code without a target, then the updates), the rules come back
4. `src/modules/settings/bas-four-digit.test.ts` checks the chart afterwards (four digits, groups, parents, no stale code, read-only)

## The four-digit migration (D68, F148)

`20261108120000_bas_four_digit`: `bas_groups` + `kind` / `group_code` / `parent_code` on `bas_categories`; the chart's 1 282 rows inserted beside the old ones; the old row's short code and French name carried to `NNN0`; a guard that **refuses the migration naming any stored code without its `NNN0`**; then `NNN` → `NNN0` on bank rows, rules, expenses, journal entries, subscriptions, supplier invoices and their lines, tenant preferences (short codes, favourites, translations, *Use for* notes ride on the row), partners' defaults and the BAS proposals' payloads; the three-digit rows deleted; the rules back. Business keys carry the short code, not the account: nothing renumbered. The codes the app names (no-proof reasons `2510` / `6570` / `7210` / `8310`, the default rules, the mock) moved with it.

Settings → BAS lists class → **group** (`65 · Other external services`, *3 of 12 active*, open when it holds an active account or a search finds something, a click opens or closes it) → accounts, sub-accounts indented under their main account. The picker groups the active accounts by the same groups inside the class order, and a word of the group's name finds them (`external` → group 65).

## The picker and the names on screen (F125, F95 part 1 — 2026-10-30)

Every BAS field reads `settings.basPickerOptions(tx)` — one builder, chart order (class, code), per account: `name` in the UI language (the tenant's own `translations.en` → the chart's `name_en` → the Swedish `name`), `nameSv` (the Swedish name, when it differs — searchable, the item's tooltip; never shown as a line, D72), `alias` (the tenant's short code → the chart's suggested alias), `classNum`, `favourite`, and the one-line `label` (`6540 · IT services (IT)`). It replaced three builders that each sorted their own way (alias first, favourites first, by code) — the order the owner read as chaotic. `BasPicker` ([[ui-conventions]] *Where it lives*) groups and searches. **What the picker suggests** (F125 PR 2): the partner's default (*the supplier's default*) and the owner's own history for that partner — *used N× before for this partner* — counted by each owning module on its own table (`partnerBasUsage`: supplier invoices, expenses, and the bank rows categorised **by hand**; a rule's or a proposal's categorisation never counts, it would teach the history what it already proposes), merged by `settings.mergeBasUsage` (three per partner, most used first) and carried by the page options as `basHistory`. On a bank row the row's own proposals come first (F98). Suggestions never fill the field: the owner clicks. **Labels outside the picker** (D72): `settings.basLabels(tx, codes)` — list columns, filters, panels — reads English the same way (`6570 · Bank charges`); the accountant's package calls it with `"sv+en"` (`6570 · Bankkostnader (Bank charges)`). Settings → BAS shows the English name first, the Swedish one small beside it, and the class headers in English.

## Related

- [[prisma-rls-setup]] — RLS pattern (used by `tenant_bas_preferences`)
- [[audit-trail]] — Audit logging for preference mutations
- [[zustand-stores]] — Tenant-scoped search state in the UI
- [[config-page-test-template]] — Test structure for this and similar config pages

## *Use for* notes (F126, `specs/ai/spec-suggest-from-first-entry.md` FR-202)

One English line per **active** account saying what goes there — `tenant_bas_preferences.use_for` (≤ 300) + `use_for_state` (`draft` | `confirmed`; a CHECK keeps both null or both set). This is where "which account for a cloud subscription, a desk in a shared office, a software licence" lives — **in the owner's data, never in code**.

- **Draft with AI** (Settings → BAS, the notes bar): the job `settings.draft-use-for` asks the local model (`prompts/bas-use-for.ts` v1) for every active account without a confirmed note, twelve per call, outside any transaction; the answers are written as **drafts**. Disabled while AI is off.
- **The owner**: a draft shows in italics with *Draft* and *Confirm*; *Confirm N drafts* takes them all; editing the *Use for* field writes his own words (confirmed); emptying it clears the note. A draft never overwrites a confirmed note, even one written while the model was answering.
- **Who reads them**: the BAS picker (the second line, and a word of the note finds the account) and the BAS proposals' prompt (`linking/proposals/prompts/bas-proposal.ts`: `code English (Swedish) — use for: …`). An edited note changes the prompt's facts, so the open rows are asked again on the next run.
