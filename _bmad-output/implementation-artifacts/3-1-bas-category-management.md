# Story 3.1: BAS Category Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to browse, activate, favorite, and customize BAS categories for my company,
so that journal entries and business keys use the correct Swedish accounting categories with my preferred shortcuts and translations.

## Acceptance Criteria

1. **Given** the owner is logged in and has tenant context
   **When** the database migrations run
   **Then** an app-level `bas_categories` reference table is seeded with the standard Swedish BAS kontoplan (~460 three-digit account groups) from official BAS 2026 data, with English names from the BAS 2025 English file and AI-generated French translations from standard accounting terminology (Plan Comptable / IFRS)

2. **Given** the `bas_categories` table exists
   **When** any authenticated user queries it
   **Then** all ~460 entries are visible (no RLS — shared reference data) and the table is read-only (immutability rules block INSERT/UPDATE/DELETE by app role)

3. **Given** the owner navigates to `/(app)/settings` and selects the BAS Categories tab
   **When** the page loads
   **Then** the tab is enabled (no longer disabled/coming-soon) and shows all BAS categories grouped by account class (1-8) in a collapsible accordion with TanStack Virtual for performance

4. **Given** the BAS categories list is displayed
   **When** the owner searches by number, Swedish name, English name, French name, or short code
   **Then** the virtualized list filters in real-time using Zustand ephemeral state

5. **Given** the owner has no active BAS categories yet (first visit)
   **When** the empty state is shown
   **Then** a "Quick-start: Activate common categories for solo AB" button is available that pre-selects ~32 curated categories relevant to a solo Swedish AB consultant, shows a preview, and requires confirmation before saving

6. **Given** the owner activates BAS categories (individually or via quick-start)
   **When** the activation is saved
   **Then** `tenant_bas_preferences` rows are created with RLS isolation, audit log entries are written, and the categories appear as active in the UI

7. **Given** the owner has active BAS categories
   **When** the owner deactivates a category
   **Then** the `tenant_bas_preferences` row is DELETEd (not soft-deleted), an audit log entry captures the old state, and the category returns to inactive in the UI

8. **Given** the owner has active BAS categories
   **When** the owner marks/unmarks categories as favorites
   **Then** the `isFavorite` flag toggles via auto-save (onChange), an audit log entry is written

9. **Given** the owner has active BAS categories
   **When** the owner edits the short code alias for a category
   **Then** the `shortCode` field saves via auto-save (onBlur), an audit log entry is written

10. **Given** the owner has active BAS categories
    **When** the owner edits the custom name/translation for a category
    **Then** the `translations` JSONB field saves via auto-save (onBlur) with Zod-validated shape `{ en?: string, sv?: string, fr?: string }`

11. **Given** the changes are saved
    **When** the page is reloaded
    **Then** all activated categories, favorites, short codes, and translations persist correctly

12. **Given** the settings page
    **When** empty states are encountered
    **Then** descriptive messages with action CTAs are shown for "no favorites yet" and "no active categories"

13. **Given** the story implementation is complete
    **When** new concepts, patterns, or configurations are introduced
    **Then** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting them

## Tasks / Subtasks

- [x] Task 0: Retro Gate Check (AC: prerequisite)
  - [x] 0.1 Verify deferred items register — no items with deadlines at or before Story 3.1
  - [x] 0.2 Document check result in Dev Notes below

- [x] Task 1: BAS Data Parser Script (AC: #1)
  - [x] 1.1 Create `prisma/data/parse-bas.mjs` — Node ESM script using `xlsx` package (dev dependency)
  - [x] 1.2 Parse English 2025 XLSX (`Chart-of-accounts-BAS-2025.xlsx`): extract 3-digit main account groups (col 2 = code, col 3 = nameEn, col 1 = markers: `■` → isCommon baseline, `[Not K2]` → flag)
  - [x] 1.3 Parse Swedish 2026 XLSX (`BAS_kontoplan_2026.xlsx`): extract 2-digit class headers (col 0 = classNum, col 1 = className) and 4-digit accounts (col 0 = code with `#` suffix for Not-K2, col 1 = name). Group 4-digit codes into 3-digit buckets; take first name per bucket as canonical Swedish name
  - [x] 1.4 Merge: English 3-digit code → Swedish 3-digit code. Swedish name = primary `name`, English name = `nameEn`. Handle mismatches (2026 vs 2025): if code exists in Swedish but not English → `nameEn = null`; if code exists in English but not Swedish 2026 → skip
  - [x] 1.5 Generate French translations (`nameFr`) from English names using standard Plan Comptable / IFRS accounting terminology. Hardcode as a `FRENCH_NAMES` map in the parser script. These are a personal comprehension aid — not official. User can override via `translations.fr` on their preferences
  - [x] 1.6 Apply curated `isCommon` overrides for solo AB consultant (~32 accounts — see Dev Notes for candidate list)
  - [x] 1.7 Apply curated `suggestedAlias` values for frequent accounts (see Dev Notes)
  - [x] 1.8 Output SQL INSERT statements to stdout, redirect to migration file
  - [x] 1.9 Add `xlsx` as devDependency: `npm install --save-dev xlsx`
  - [x] 1.10 Add `prisma/data/*.xlsx` and `prisma/data/*.pdf` to `.gitignore` (already done)

- [x] Task 2: Database Migration — bas_categories reference table (AC: #1, #2)
  - [x] 2.1 Create Prisma migration with CREATE TABLE `bas_categories`: `code VARCHAR(4) PRIMARY KEY`, `name TEXT NOT NULL`, `name_en TEXT`, `name_fr TEXT`, `class_name TEXT NOT NULL`, `class_num INTEGER NOT NULL`, `is_common BOOLEAN NOT NULL DEFAULT false`, `suggested_alias VARCHAR(10)`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - [x] 2.2 **NO RLS** on `bas_categories` — this is app-level shared reference data, not tenant-scoped (see Dev Notes: Architectural Exception)
  - [x] 2.3 Add immutability rules: `CREATE RULE no_update_bas AS ON UPDATE TO bas_categories DO INSTEAD NOTHING;` and `CREATE RULE no_delete_bas AS ON DELETE TO bas_categories DO INSTEAD NOTHING;`
  - [x] 2.4 `GRANT SELECT ON TABLE bas_categories TO defterfab_app` — SELECT only, no write permissions
  - [x] 2.5 Run parser script output and include INSERT statements (~460 rows) in the migration SQL
  - [x] 2.6 Add migration comment block explaining: what BAS is, why no RLS, why immutability, how to update yearly

- [x] Task 3: Database Migration — tenant_bas_preferences tenant table (AC: #6, #7, #8, #9, #10)
  - [x] 3.1 Create `tenant_bas_preferences` table: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `tenant_id UUID NOT NULL`, `bas_code VARCHAR(4) NOT NULL REFERENCES bas_categories(code)`, `is_favorite BOOLEAN NOT NULL DEFAULT false`, `short_code VARCHAR(10)`, `translations JSONB`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `created_by UUID NOT NULL`, `source VARCHAR(20) NOT NULL DEFAULT 'web'`
  - [x] 3.2 Add `UNIQUE(tenant_id, bas_code)` constraint
  - [x] 3.3 Enable RLS: `ALTER TABLE tenant_bas_preferences ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant_bas_preferences FORCE ROW LEVEL SECURITY;`
  - [x] 3.4 Create tenant isolation policy with both USING and WITH CHECK (matching audit_logs pattern): `CREATE POLICY tenant_isolation ON tenant_bas_preferences USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`
  - [x] 3.5 `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant_bas_preferences TO defterfab_app`
  - [x] 3.6 Add indexes: `(tenant_id, is_favorite)`, `(tenant_id, bas_code)`

- [x] Task 4: Prisma Schema Update (AC: #1, #6)
  - [x] 4.1 Add `BasCategory` model to `prisma/schema/app.prisma` — `code` as `@id` (natural key, NOT UUID), `name`, `nameEn`, `nameFr`, `className`, `classNum`, `isCommon`, `suggestedAlias`, `createdAt`, relation to `TenantBasPreference[]`
  - [x] 4.2 Add `TenantBasPreference` model to `prisma/schema/app.prisma` — follows mandatory template (id, tenantId, createdAt, updatedAt, createdBy, source), plus `basCode` FK to BasCategory, `isFavorite`, `shortCode`, `translations` (Json? @db.JsonB)
  - [x] 4.3 Add `basPreferences TenantBasPreference[]` relation to existing `Tenant` model
  - [x] 4.4 Run `npx prisma generate` — verify client generation succeeds

- [x] Task 5: Service Layer (AC: #6, #7, #8, #9, #10)
  - [x] 5.1 Create `src/server/services/bas-preferences.ts` with `ServiceResult<T>` return types. Import types: `TransactionClient` from `@/server/db/tenant-client`, `CallerIdentity` from `@/types/caller-identity`, `AuditLogger` from `@/types/audit`, `AppError` from `@/types/app-error`. Use `toAuditData()` from `@/server/services/audit` for audit data sanitization
  - [x] 5.2 `getBasCategories(tx: TransactionClient)` — read-only, no `caller` or `audit` params needed. Query `bas_categories` ordered by classNum, code. No tenant context needed (no RLS on this table). Note: even though no RLS, this method still receives `tx` from the middleware chain
  - [x] 5.3 `getTenantBasPreferences(tx: TransactionClient, caller: CallerIdentity)` — read-only, no `audit` param. Query `tenant_bas_preferences` (RLS-scoped by middleware). Include relation to `basCategory` for joined data
  - [x] 5.4 `activateBasCategories(tx: TransactionClient, caller: CallerIdentity, audit: AuditLogger, codes: string[])` — bulk createMany into `tenant_bas_preferences`. Validate codes exist in `bas_categories`. Audit log each activation with `entityType: "tenant_bas_preference"`
  - [x] 5.5 `deactivateBasCategory(tx: TransactionClient, caller: CallerIdentity, audit: AuditLogger, basCode: string)` — DELETE from `tenant_bas_preferences`. Read-before-delete for audit oldData. Audit with `entityType: "tenant_bas_preference"`
  - [x] 5.6 `updateBasPreference(tx: TransactionClient, caller: CallerIdentity, audit: AuditLogger, basCode: string, input: { isFavorite?, shortCode?, translations? })` — update existing preference. Audit with `entityType: "tenant_bas_preference"`. Validate translations shape with Zod: `z.object({ en: z.string().optional(), sv: z.string().optional(), fr: z.string().optional() }).optional()`
  - [x] 5.7 Ensure service MUST NOT import from `next/*` or `src/components/*`

- [x] Task 6: Server Actions (AC: #6, #7, #8, #9, #10)
  - [x] 6.1 Create `src/server/actions/bas-preferences.ts`
  - [x] 6.2 `getBasCategories` — `authedAction` (any authenticated user can read reference data). Note: this differs from `settings.ts` which uses `ownerAction` for all reads. BAS reference data is intentionally broader access since any user may need category names for display
  - [x] 6.3 `getTenantBasPreferences` — `authedAction` (read own tenant's preferences, RLS-scoped)
  - [x] 6.4 `activateBasCategories` — `ownerAction` with schema `z.object({ codes: z.array(z.string().min(1).max(4)) })`
  - [x] 6.5 `deactivateBasCategory` — `ownerAction` with schema `z.object({ basCode: z.string().min(1).max(4) })`
  - [x] 6.6 `updateBasPreference` — `ownerAction` with schema for isFavorite, shortCode, translations
  - [x] 6.7 All write actions use `ownerAction` — owner-only RBAC enforcement

- [x] Task 7: UI Component — BAS Categories Tab (AC: #3, #4, #5, #12)
  - [x] 7.1 Create `src/components/settings/bas-categories-tab.tsx`
  - [x] 7.2 Accordion navigation by account class (1-8) using 2-digit group headers as section names. Show both Swedish className and English equivalent in lighter text
  - [x] 7.3 TanStack Virtual for rendering ~460 rows within each class accordion section
  - [x] 7.4 Search/filter bar: Zustand store for ephemeral search state (uses `createTenantStore` from Story 3.0). Filter across code, name, nameEn, nameFr, shortCode
  - [x] 7.5 Toggle activation: checkbox/switch per category, auto-save onChange. Follow `useAction()` pattern from `src/components/domain/company-profile-form.tsx`
  - [x] 7.6 Favorite toggle: star icon, auto-save onChange
  - [x] 7.7 Short code edit: inline text input, auto-save onBlur (field-level save with `useAction()` + `executeAsync`)
  - [x] 7.8 Translations edit: inline text inputs for `en`, `sv`, and `fr` fields, auto-save onBlur
  - [x] 7.9 Quick-start button: "Activate common for solo AB" — fetches `isCommon: true` categories, shows preview with checkboxes, confirm button calls `activateBasCategories` with selected codes
  - [x] 7.10 Empty states: "No active categories" with quick-start CTA; "No favorites yet" with guidance text
  - [x] 7.11 Visual indicators: active/inactive state, favorite star, K2-restricted categories greyed with tooltip
  - [x] 7.12 Verify `@tanstack/react-virtual` is available (already installed as `^3.13.21`)

- [x] Task 8: Settings Page Integration (AC: #3)
  - [x] 8.1 Enable the BAS Categories tab in `src/app/(app)/settings/page.tsx` — remove `disabled` prop, add route link like Company tab
  - [x] 8.2 Create `src/app/(app)/settings/bas-categories/page.tsx` — follow `settings/company/page.tsx` pattern: server component with `getAuthContext` + member role check + redirect non-owners to `/dashboard`, then fetch initial data via `withTenantTransaction` and render `BasCategoriesTab` client component with props
  - [x] 8.3 Ensure tab navigation works between Company and BAS Categories

- [x] Task 9: Service & RLS Tests (AC: #2, #6, #7, #8, #9, #10)
  - [x] 9.1 Create `src/server/services/bas-preferences.test.ts`
  - [x] 9.2 Test `bas_categories` immutability: verify INSERT/UPDATE/DELETE blocked for app role
  - [x] 9.3 Test `bas_categories` row count: assert ~460 entries seeded
  - [x] 9.4 Test `bas_categories` spot-check: verify known accounts (e.g., code `501` = "Lokalhyra", code `899` = "Resultat") exist with correct data
  - [x] 9.5 Use `assertRlsIsolation(prisma, "tenantBasPreference", tenantA.id, tenantB.id)` for tenant isolation
  - [x] 9.6 Use `assertAuditLogged(adminPool, tenantId, "create", "tenant_bas_preference")` for audit trail
  - [x] 9.7 Test bulk activation: activate 32 codes, verify all created
  - [x] 9.8 Test deactivation: delete preference, verify audit captures old state
  - [x] 9.9 Test duplicate activation: same code twice → unique constraint handled gracefully (AppError, not throw)
  - [x] 9.10 Test update: isFavorite toggle, shortCode change, translations update
  - [x] 9.11 Test translations validation: reject invalid JSONB shapes
  - [x] 9.12 Use `assertCrudOperations` from config-crud-helpers for a full activate/read/update/deactivate cycle test

- [x] Task 10: Architecture Guard Test Update (AC: #2)
  - [x] 10.1 Verify existing architecture guard tests pass with new files (no `GRANT ALL`, no `console.*`, no `next/*` in services)
  - [x] 10.2 If needed, add exception for `bas_categories` GRANT pattern (SELECT-only is not GRANT ALL, should pass)

- [x] Task 11: Documentation & Cleanup (AC: all, #13)
  - [x] 11.1 Update `docs/index.md` with link to any new docs
  - [x] 11.2 Add inline code comments documenting: no-RLS exception, natural key pattern, yearly update process
  - [x] 11.3 Update `docs/` with Obsidian-style `[[wiki-links]]` for new concepts: BAS categories reference table, no-RLS shared data pattern, natural key pattern, sparse preferences pattern
  - [x] 11.4 Run `npx biome check --write` before each commit
  - [x] 11.5 Run full test suite: `npm run test` — all existing tests + new tests pass
  - [x] 11.6 Run `npm run lint` — clean

## Dev Notes

### Task Dependencies

Tasks must be executed in order due to dependencies:
- **Task 1 → Task 2**: Parser script generates INSERT SQL for the migration
- **Task 2 → Task 3**: `tenant_bas_preferences.bas_code` references `bas_categories(code)`
- **Tasks 2+3 → Task 4**: Prisma schema must match the migration SQL
- **Task 4 → Tasks 5+6**: Services and actions need generated Prisma client
- **Tasks 5+6 → Task 7**: UI components consume the server actions
- **Task 7 → Task 8**: Settings page integration needs the component
- **Tasks 5-8 → Task 9**: Tests need all code written first
- **Tasks 9+10 → Task 11**: Docs after everything passes

### Pattern-Setter Story

This is the **first config CRUD page** in the application. Patterns established here are reused by Stories 3.2 (VAT), 3.3 (Bank Accounts), 3.4 (Doc Prefixes). Keep scope minimal and patterns clean.

### Architectural Exception: No RLS on bas_categories

`bas_categories` is a **shared app-level reference table** — identical for all tenants, publicly available data from the Swedish BAS standard. No RLS because:
- No `tenant_id` column (data is not tenant-scoped)
- Read-only (immutability rules + SELECT-only GRANT)
- Data is non-sensitive (published by bas.se)

Only `tenant_bas_preferences` gets full RLS with tenant isolation policy.

### Natural Key Pattern

`BasCategory.code` uses the BAS account code as `@id` (e.g., `"501"`) instead of UUID. This enables:
- Human-readable foreign keys in `tenant_bas_preferences.bas_code`
- Direct lookup without UUID mapping
- Matches the official BAS numbering system

The `AuditLog.entityId` column is already `String` (not `@db.Uuid`), so it accommodates non-UUID IDs.

### BAS Data Source Files

Source files in `prisma/data/` (gitignored — proprietary BAS data):
- `BAS_kontoplan_2026.xlsx` — Swedish 2026 kontoplan (1,152 rows, 472 four-digit main accounts, 70 two-digit class headers)
- `Chart-of-accounts-BAS-2025.xlsx` — English 2025 translation (1,326 rows, 460 three-digit groups, 1,230 four-digit sub-accounts, 195 common-marked groups)
- `BAS_kontoplan_2026.pdf` — PDF reference

### Row Count Clarification (~460 vs ~2,500)

The epics file mentions "~2,500 kontoplan entries" — that includes all 4-digit sub-accounts. This story displays only **~460 three-digit main account groups** (the `BasCategory.code` level). TanStack Virtual is still used for smooth rendering of ~460 rows across 8 accordion sections.

### Data Analysis Results

**Swedish file structure** (single sheet: "Kontoplan 2026"):
- Col 0: 2-digit number = class/group header (e.g., `10` → "IMMATERIELLA ANLÄGGNINGSTILLGÅNGAR"); 4-digit string = main account (e.g., `"1010#"` where `#` = Not K2)
- Col 1: Swedish name
- Col 2: 4-digit sub-account code
- Col 3: Sub-account name

**English file structure** (single sheet: "Accounts"):
- Col 1: markers — `■` = common (adequate for basic accounting), `[Not K2]` = restricted
- Col 2: 3-digit group code (our `BasCategory.code`)
- Col 3: English group name (our `nameEn`)
- Col 6: 4-digit sub-account code
- Col 7: Sub-account English name

**Mapping logic**: English 3-digit code × 10 = Swedish 4-digit range start. E.g., English `101` maps to Swedish `1010-1019`; take `1010`'s name as canonical Swedish name for group `101`.

**Account classes** (8 classes, 70 two-digit groups, ~460 three-digit main accounts):
| Class | Swedish Name | English Equivalent | 3-digit groups | Common (■) |
|-------|-------------|-------------------|----------------|------------|
| 1 | Tillgångar | Assets | 78 | 40 |
| 2 | Eget kapital & skulder | Equity & Liabilities | 71 | 36 |
| 3 | Intäkter | Revenue | 42 | 20 |
| 4 | Varuinköp | Cost of goods | 22 | 18 |
| 5 | Lokalkostnader m.m. | Premises & other | 76 | 23 |
| 6 | Övriga kostnader | Other costs | 63 | 18 |
| 7 | Personal | Personnel | 58 | 25 |
| 8 | Finansiellt | Financial | 50 | 15 |

### Curated isCommon List (~32 solo AB consultant accounts)

The `■` marker from BAS marks 195 groups as "common for basic accounting." That's too broad for quick-start. Curate ~32 specifically for a solo Swedish AB consultant:

**Candidate codes** (validate against actual parser output — codes are 3-digit group codes from English file):

Class 1 (Assets): `126` (Leased assets), `153` (Customer receivables), `193`/`194` (Bank accounts), `197` (Petty cash)
Class 2 (Equity/Liabilities): `208` (Equity), `244` (Supplier payables), `261`/`262`/`269` (VAT accounts)
Class 3 (Revenue): `301` (Consulting revenue), `361` (Side revenue), `399` (Other revenue)
Class 5 (Premises): `501` (Premises costs), `512` (Electricity), `540` (Consumables)
Class 6 (Other costs): `541` (Office supplies), `580` (Travel), `591` (Advertising), `620` (Telecom/IT), `631` (Insurance), `640` (Admin), `650` (Accounting services), `690` (Other external)
Class 7 (Personnel): `722` (Director salary), `731` (Mileage), `757` (Social security), `769` (Other personnel)
Class 8 (Financial): `836` (Interest income), `841` (Interest expense), `891` (Income tax), `899` (Result)

### Curated suggestedAlias Values

Short Swedish abbreviations for the most common solo AB accounts:
- `501` → "Lokal", `620` → "Tele", `722` → "Lön", `891` → "Skatt", `301` → "Konsult", `244` → "Lev", `153` → "Kund", `580` → "Resa"

### Translations JSONB Shape

```typescript
// Zod schema for validation
const translationsSchema = z.object({
  en: z.string().optional(),
  sv: z.string().optional(),
  fr: z.string().optional(),
}).optional();
```

The `translations` field on `TenantBasPreference` lets the user override any app-level name. If `translations.fr` is set, it takes display priority over `BasCategory.nameFr`.

### French Translations — Context

The owner (Zik) is a native French speaker. French translations are a **personal comprehension aid** for understanding Swedish/English accounting terms — not used in any official process or export. The app-level `nameFr` column is populated with AI-generated translations using standard Plan Comptable Général / IFRS terminology. These are reliable for standardized accounting terms. The user can override any translation via `TenantBasPreference.translations.fr` if a specific term feels wrong.

### Schema Models

```prisma
// In prisma/schema/app.prisma

// BAS reference table — NO RLS, read-only, natural key
// Not following mandatory template: this is app-level reference data, not tenant-scoped
model BasCategory {
  code           String   @id              // "501" — 3-digit BAS group code
  name           String                    // "Lokalkostnader" — Swedish canonical
  nameEn         String?  @map("name_en")  // "Premises costs" — from English 2025 file
  nameFr         String?  @map("name_fr")  // "Frais de locaux" — AI-generated, Plan Comptable/IFRS terminology
  className      String   @map("class_name") // "LOKALKOSTNADER" — stored uppercase per BAS standard
  classNum       Int      @map("class_num")  // 5 — first digit of code
  isCommon       Boolean  @default(false) @map("is_common")
  suggestedAlias String?  @map("suggested_alias") // "Lokal" — curated short label
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz

  preferences TenantBasPreference[]

  @@map("bas_categories")
}

// Tenant preferences — full RLS, follows mandatory template
model TenantBasPreference {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  basCode      String   @map("bas_code")    // FK to BasCategory.code
  isFavorite   Boolean  @default(false) @map("is_favorite")
  shortCode    String?  @map("short_code")  // User-defined alias
  translations Json?    @db.JsonB           // { en?: string, sv?: string, fr?: string }
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz
  createdBy    String   @map("created_by") @db.Uuid
  source       String   @default("web")

  basCategory BasCategory @relation(fields: [basCode], references: [code])
  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, basCode])
  @@index([tenantId, isFavorite])
  @@map("tenant_bas_preferences")
}
```

### Service Pattern — First Non-RLS Query

`getBasCategories()` is the first service method that queries a table without RLS. The pattern:
- Action uses `authedAction` (user must be logged in to access settings)
- Middleware sets tenant context as usual
- Service receives `TransactionClient` from middleware chain
- Query hits `bas_categories` without `WHERE tenant_id = ...` (no such column)
- This is safe because the table is read-only reference data

Document this as an established pattern for app-level reference tables.

### Yearly BAS Update Process

BAS releases updated kontoplaner annually (~5-10 account changes per year). Update process:
1. Download new XLSX files from bas.se to `prisma/data/`
2. Re-run `node prisma/data/parse-bas.mjs > new-inserts.sql`
3. Diff against current migration data
4. Create new migration with adds/changes (additive — never edit applied migrations)

### Previous Story Intelligence (Story 3.0)

- **183 tests passing** (167 original + 16 new guard/pattern tests) — must not regress
- `createTenantStore` factory in `src/lib/stores/create-tenant-store.ts` — use for BAS search/filter state
- Config CRUD helpers ready: `assertRlsIsolation`, `assertAuditLogged`, `assertCrudOperations`
- Architecture guard tests enforce: no GRANT ALL, no console.*, no next/* in services
- Zustand 5.0.11 reactive pattern established — first real consumer is this story
- **Migration safety**: always additive (new migration files), never edit applied migrations
- **Biome check before commit**: `npx biome check --write`
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`

### Project Structure Notes

All paths follow project conventions:
- Services: `src/server/services/bas-preferences.ts` (kebab-case)
- Actions: `src/server/actions/bas-preferences.ts` (kebab-case)
- Components: `src/components/settings/bas-categories-tab.tsx` (kebab-case file, PascalCase component)
- Tests: co-located `.test.ts` files
- Prisma schema: `prisma/schema/app.prisma` (existing file, add models)
- Parser: `prisma/data/parse-bas.mjs` (dev tooling, not production code)

### Downstream Consumer: BASCategoryPicker (Story 6.4)

The UX spec defines a `BASCategoryPicker` domain component used in journal entries (Story 6.4): "Starred favorites at top, full searchable list below, short code alias shown per entry." This story (3.1) establishes the data layer that the picker will consume — activated categories, favorites, short codes. Design the data model and service API with this downstream usage in mind, but do NOT build the picker component here.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1] — acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Q9] — sparse preferences pattern
- [Source: _bmad-output/planning-artifacts/prd.md#FR40a-d] — BAS functional requirements
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#BASCategoryPicker] — UX component spec
- [Source: docs/config-page-test-template.md] — test structure template
- [Source: src/server/test-utils/config-crud-helpers.ts] — reusable test helpers
- [Source: _bmad-output/implementation-artifacts/3-0-epic-3-prep-sprint.md] — prep sprint patterns
- [Source: docs/story-creation-checklist.md] — mutation story checklist
- [Source: src/server/actions/settings.ts] — production server action pattern
- [Source: src/server/services/settings.ts] — service layer pattern
- [Source: src/app/(app)/settings/page.tsx#L17-L19] — disabled BAS tab to enable
- [Source: src/components/domain/company-profile-form.tsx] — canonical auto-save pattern with `useAction()` + field-level `onBlur`
- [Source: src/app/(app)/settings/company/page.tsx] — server component page pattern (auth + data fetch + render client component)
- [Source: src/types/caller-identity.ts] — CallerIdentity type
- [Source: src/types/audit.ts] — AuditLogger interface
- [Source: src/types/app-error.ts] — AppError type and ErrorCode enum
- [Source: src/server/services/audit.ts] — createAuditEntry + toAuditData helpers

### Mutation Story Checklist

- [x] RLS policy task — Task 3.3, 3.4 (tenant_bas_preferences only; bas_categories is no-RLS exception)
- [x] Specific GRANTs task — Task 2.4 (SELECT only for bas_categories), Task 3.5 (full CRUD for tenant_bas_preferences)
- [x] Audit log integration task — Task 5.4, 5.5, 5.6 (activate/deactivate/update all audit-logged)
- [x] RLS isolation test — Task 9.5 (assertRlsIsolation)
- [x] Audit log test — Task 9.6 (assertAuditLogged)
- [x] Immutability rules — Task 2.3 (bas_categories is read-only)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Task 0: Retro gate check passed. Deferred items #4-#8 all have deadlines at Epic 5+. Items #1-#3 resolved in Story 3.0.

### File List

- `.gitignore` — Added `prisma/data/*.xlsx` and `prisma/data/*.pdf` exclusions
- `package.json` / `package-lock.json` — Added `xlsx` devDependency
- `prisma/data/parse-bas.mjs` — BAS XLSX parser script (generates migration SQL)
- `prisma/migrations/20260312035401_add_bas_categories/migration.sql` — CREATE TABLE bas_categories + tenant_bas_preferences, RLS, GRANTs, seed data
- `prisma/migrations/20260312055000_fix_bas_categories_insert_rule/migration.sql` — Fix INSERT permissions on bas_categories
- `prisma/schema/app.prisma` — Added BasCategory and TenantBasPreference models, Tenant relation
- `src/server/services/bas-preferences.ts` — Service layer: CRUD operations with audit logging
- `src/server/actions/bas-preferences.ts` — Server actions: authed/owner wrappers
- `src/components/settings/bas-categories-tab.tsx` — Client component: virtual list, accordion, auto-save
- `src/app/(app)/settings/bas-categories/page.tsx` — Server page: auth, data fetch, render
- `src/app/(app)/settings/page.tsx` — Enabled BAS Categories tab navigation
- `src/server/services/bas-preferences.test.ts` — 24 tests: immutability, CRUD, RLS, audit, actions
- `docs/bas-categories.md` — Documentation: patterns, yearly update process
- `docs/index.md` — Added bas-categories link
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Status: review

### Change Log

- 2026-03-12: Initial implementation (Tasks 1-11) — Claude Opus 4.6
- 2026-03-12: Code review fixes — toast error feedback, duplicate DOM id fix, virtual list state lift, InlineField sync, quick-start error handling, TabsTrigger nativeButton fix
