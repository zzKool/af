# BAS Categories

Swedish BAS kontoplan (chart of accounts) reference data and tenant customization.

## Overview

BAS categories represent the ~472 three-digit account groups from the official Swedish [[BAS 2026|https://bas.se]] standard. They serve as shared reference data for all tenants — no tenant owns or modifies the canonical BAS entries.

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

- Three-digit BAS codes (e.g., "100", "301") are globally unique and stable
- Simplifies queries — no JOIN needed to filter by code
- `tenant_bas_preferences.bas_code` references `bas_categories.code` directly
- `AuditLog.entityId` stores the natural key string (e.g., "301")

### Sparse Preferences

Not every BAS category needs a preference row. `tenant_bas_preferences` rows are created on-demand:

- Activating a category creates a preference row (or updates `isFavorite`)
- Deactivating deletes the preference row entirely
- Categories without a preference row are "available but inactive"
- Other modules ask `isBasActivated(tx, code)` (settings' `queries.ts`) instead of reading `tenant_bas_preferences` ([[lessons]] audit 25)
- This keeps the table small (~30-50 rows per tenant vs ~472 categories)

## Yearly Update Process

The BAS standard is updated annually. To update:

1. Download new XLSX files from bas.se (Swedish + English versions)
2. Run `node prisma/data/parse-bas.mjs` to generate INSERT SQL
3. Create a new Prisma migration with the updated seed data
4. Handle any code changes (renamed/removed/added categories)
5. Existing `tenant_bas_preferences` rows remain valid unless codes are removed

## The picker and the names on screen (F125, F95 part 1 — 2026-10-30)

Every BAS field reads `settings.basPickerOptions(tx)` — one builder, chart order (class, code), per account: `name` in the UI language (the tenant's own `translations.en` → the chart's `name_en` → the Swedish `name`), `nameSv` (the Swedish name, when it differs — the picker's second line), `alias` (the tenant's short code → the chart's suggested alias), `classNum`, `favourite`, and the one-line `label` (`654 · IT services (IT)`). It replaced three builders that each sorted their own way (alias first, favourites first, by code) — the order the owner read as chaotic. `BasPicker` ([[ui-conventions]] *Where it lives*) groups and searches. Left of F95: the **list columns and filters** still read `basLabels` (Swedish), and the accountant's package keeps the Swedish names on purpose.

## Related

- [[prisma-rls-setup]] — RLS pattern (used by `tenant_bas_preferences`)
- [[audit-trail]] — Audit logging for preference mutations
- [[zustand-stores]] — Tenant-scoped search state in the UI
- [[config-page-test-template]] — Test structure for this and similar config pages
