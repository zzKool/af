# Story 3.4: Document-Type Prefixes & Personal Locale

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to configure document-type prefixes for business key generation and set my personal display preferences,
so that uploaded documents get meaningful identifiers and dates/numbers display in my preferred format.

## Acceptance Criteria

1. A tenant-level `document_type_prefixes` table stores customizable prefixes (e.g., `exp_`, `inv_`, `ctrt_`, `nda_`, `cert_`) (FR41)
2. The owner can add, edit, and remove document-type prefixes
3. Default prefixes are auto-seeded on first access (seed-on-first-access pattern in service layer)
4. A user-level `locale` preference stores date and number formatting preferences (FR44)
5. `src/lib/format-date.ts` formats dates according to the user's locale preference (default: browser locale, fallback sv-SE)
6. Locale changes take effect immediately across the UI
7. `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting any new concepts, patterns, or configurations introduced

## Tasks / Subtasks

- [x] Task 1: Database schema — Document-Type Prefixes model (AC: #1, #3)
  - [x] 1.1 Add `DocumentTypePrefix` model to `prisma/schema/app.prisma` with mandatory template fields (`id`, `tenantId`, `createdAt`, `updatedAt`, `createdBy`, `source`) plus `documentType` (string, e.g. "expense", "invoice", "contract", "nda", "certificate") and `prefix` (string, e.g. "exp_", "inv_")
  - [x] 1.2 Add unique constraint `@@unique([tenantId, documentType])` — one prefix per document type per tenant
  - [x] 1.3 Add RLS policy `tenant_isolation ON document_type_prefixes` in migration SQL
  - [x] 1.4 Add audit trigger for `document_type_prefixes` table
  - [x] 1.5 Define default prefixes in `src/lib/constants.ts` as `DEFAULT_DOCUMENT_TYPE_PREFIXES`: `{ expense: "exp_", invoice: "inv_", contract: "ctrt_", nda: "nda_", certificate: "cert_" }`
  - [x] 1.6 No migration seed needed — defaults are auto-seeded via seed-on-first-access pattern in `seedDocumentTypePrefixes()` service (see Task 3.2). No tenant-creation hook required. Add a `prefixes_seeded` key to `TenantConfig` (existing key-value table) to track whether defaults have been seeded — this prevents the delete-all-then-reseed bug (user deletes all prefixes, navigates away, returns → empty list stays empty, NOT re-seeded)
  - [x] 1.7 Create migration file `prisma/migrations/YYYYMMDD_add_document_type_prefixes_and_user_locale/migration.sql`

- [x] Task 2: Database schema — User Locale Preference (AC: #4)
  - [x] 2.1 Create a `UserPreference` model in `app.prisma` (NOT `auth.prisma` — avoids Better Auth migration conflicts on upgrades). Fields: `id` (UUID), `userId` (String @unique @db.Uuid — plain field with NO Prisma @relation, same pattern as AuditLog.userId; cross-schema FK to auth user enforced at application level only), `locale` (string, default null — null means "use browser locale"), `source` (String, default "manual" — included per mandatory template, always "manual" for user preferences), `createdAt`, `updatedAt`. Add Prisma schema comment: `/// User-scoped (not tenant-scoped). Access controlled by userId from auth context, not RLS.`
  - [x] 2.2 No RLS needed for user preferences — access is scoped by `userId` from auth context, not by `tenantId`. Migration SQL MUST explicitly omit RLS (add comment: `-- NO ROW LEVEL SECURITY on user_preferences (user-scoped, not tenant-scoped)`) to prevent dev agent from adding RLS by habit
  - [x] 2.3 Include in the same migration as Task 1.7

- [x] Task 3: Service layer — Document-Type Prefixes (AC: #1, #2, #3)
  - [x] 3.1 Create `src/server/services/document-type-prefixes.ts` following the established service pattern (CallerIdentity, AuditLogger, ServiceResult)
  - [x] 3.2 Implement two functions with clean read/write separation:
    - `getDocumentTypePrefixes(tx, caller)` — **pure read**, returns all prefixes for caller's tenant. Returns empty array if none exist. Does NOT perform writes.
    - `seedDocumentTypePrefixes(tx, caller, audit)` — **mutation**, inserts defaults from `DEFAULT_DOCUMENT_TYPE_PREFIXES` constant, logs audit for each created prefix with `source: "system"`, and sets `prefixes_seeded = "true"` in `TenantConfig`.
    - The **action layer** orchestrates: check `TenantConfig` for `prefixes_seeded` flag → if not seeded, call `seedDocumentTypePrefixes()` → then call `getDocumentTypePrefixes()` and return results. This keeps read/write separation clean and ensures proper audit trail for seed operations.
  - [x] 3.3 Implement `createDocumentTypePrefix(tx, caller, audit, input)` — validates no duplicate `documentType` for tenant, creates prefix, logs audit
  - [x] 3.4 Implement `updateDocumentTypePrefix(tx, caller, audit, id, input)` — partial update of `prefix` field, read-before-write for audit
  - [x] 3.5 Implement `deleteDocumentTypePrefix(tx, caller, audit, id)` — hard delete (no downstream references yet). Add TODO comment: `// TODO: Epic 5 — check for documents using this prefix before allowing delete`
  - [x] 3.6 Validate `prefix` format: regex `/^[a-z0-9]+_$/`, max 10 chars. Zod schema auto-lowercases input via `.toLowerCase()` before validation. Rejects: empty, no trailing `_`, uppercase, special chars, unicode, double underscores
  - [x] 3.7 Validate `documentType`: non-empty, max 30 chars, lowercase alphanumeric + hyphens only. Document types are free-form strings (no enum) — the prefix table IS the configurable document type registry. Users can create types ahead of Epic 5

- [x] Task 4: Service layer — User Locale (AC: #4, #5)
  - [x] 4.1 Create `src/server/services/user-preferences.ts` (or add to existing settings service if small)
  - [x] 4.2 Implement `getUserPreferences(tx, caller)` — returns user's locale preference (or null for browser default)
  - [x] 4.3 Implement `updateUserLocale(tx, caller, audit, locale)` — validates locale is in supported list, **upserts** preference (create-if-not-exists, update-if-exists via Prisma `upsert` on unique `userId`). First locale selection creates the `UserPreference` row; subsequent changes update it. Pass `null` to reset to browser locale default
  - [x] 4.4 Define supported locales constant in `src/lib/constants.ts`: `SUPPORTED_LOCALES = ["sv-SE", "en-US", "en-GB", "fr-FR", "de-CH"] as const`
  - [x] 4.5 ~~REMOVED — duplicate of Task 1.5~~

- [x] Task 5: Server Actions (AC: #1, #2, #4)
  - [x] 5.1 Create `src/server/actions/document-type-prefixes.ts` — thin wrappers using `ownerAction` for all CRUD operations
  - [x] 5.2 Add `getUserPreferences` action using `authedAction` (any authenticated user can read/update their own locale) and `updateUserLocale` action using `authedAction`
  - [x] 5.3 Zod schemas: `createDocumentTypePrefixSchema`, `updateDocumentTypePrefixSchema`, `updateUserLocaleSchema`
  - [x] 5.4 Follow the established pattern from `src/server/actions/settings.ts` — return AppError in data, never throw

- [x] Task 6: Format utilities (AC: #5, #6)
  - [x] 6.1 UPDATE existing `src/lib/format-date.ts` (already has `formatDateTime()` and `formatDateShort()` using `Intl.DateTimeFormat`). Add a `formatDate(date, locale?)` convenience wrapper alongside existing functions. Do NOT rename or remove existing exports — no breaking changes
  - [x] 6.2 CREATE new `src/lib/format-number.ts` — export `formatNumber(value, locale?)` that uses `Intl.NumberFormat`. **CRITICAL: `formatNumber()` is for NON-MONETARY values only** (quantities, percentages, generic numbers). Currency amounts MUST continue using existing `formatCurrency()` from `src/lib/format-currency.ts` which uses currency-specific conventions (SEK: space thousands + comma decimal, CHF: apostrophe thousands + period decimal). Architecture rule: "Currency formatting follows the currency's convention, not the user's locale." Do NOT use locale-based number formatting for money.
  - [x] 6.3 Ensure these formatters accept an optional locale parameter; when omitted, use the user's stored preference from React context, falling back to browser locale. Add `resolveLocale()` helper in `src/lib/format-date.ts` (co-located with other format logic) that checks `Intl.DateTimeFormat.supportedLocalesOf([locale])` and falls back gracefully if unsupported. Re-export from `format-number.ts` if needed there
  - [x] 6.4 Create a `LocaleProvider` React context (`src/components/providers/locale-provider.tsx`) with `useLocale()` hook. **Server/client flow**: `src/app/(app)/layout.tsx` fetches user locale server-side via **direct Prisma query** `prisma.userPreference.findUnique({ where: { userId } })` — NOT wrapped in `withTenantTransaction` because UserPreference is user-scoped with no RLS. This is the first non-tenant query in the layout — do NOT follow the tenant-transaction pattern here. Pass locale as prop to `LocaleProvider` → client components use `useLocale()` hook → server components accept `locale` as explicit prop. Locale changes update context immediately (no page reload). This is infrastructure only — existing date displays are NOT retrofitted. Future stories adopt `formatDate`/`formatNumber` organically when their components are built/touched

- [x] Task 7: UI — Document-Type Prefixes settings tab (AC: #1, #2, #3)
  - [x] 7.1 Create route `src/app/(app)/settings/document-prefixes/page.tsx` — server component that fetches prefixes via `getDocumentTypePrefixes` action, enforces owner role
  - [x] 7.2 Create `src/components/settings/document-type-prefixes-tab.tsx` — client component following the bank-accounts-tab pattern:
    - Card-based list of document-type prefixes showing `documentType` label, `prefix` value, and a **static illustrative example** below each card in `muted-foreground` 12px caption (e.g., `exp_20260313_Tr_Lufthansa_001.pdf *(illustrative)*`). Show the pattern explanation once at the top: `[prefix][date]_[BAS]_[partner]_[sequence].ext`. The example updates the prefix portion live when the user edits it, but BAS/partner segments are static placeholder text since those entities don't exist yet (Epic 4/5)
    - Add new prefix form (documentType + prefix fields)
    - Inline edit: prefix field saves onBlur (auto-save pattern)
    - Delete with confirmation dialog
    - No empty state needed — seed-on-first-access ensures defaults always present
  - [x] 7.3 Add "Document Prefixes" tab to settings page navigation in `src/app/(app)/settings/page.tsx`. **CRITICAL: `settings/page.tsx` is currently a synchronous component with NO auth context.** It must be converted to an `async` server component that calls `getAuthContext()` + resolves member role (same pattern as `bank-accounts/page.tsx`). Then implement **role-based tab filtering**: define each tab with a `roles` array (e.g., `{ value: "company", label: "Company", roles: ["owner"] }`, `{ value: "my-preferences", label: "My Preferences", roles: ["owner", "accountant"] }`). Filter visible tabs by `member.role`. Owner sees all tabs; accountant sees only "My Preferences." Set `defaultValue` dynamically: owner → `"company"`, accountant → `"my-preferences"` (since that's their only visible tab). Update `src/lib/constants.ts` sidebar nav to allow accountant access to `/settings`: change settings roles from `["owner"]` to `["owner", "accountant"]`. Final tab order: Company | BAS Categories | VAT Registrations | Bank Accounts | Document Prefixes | [visual separator] | My Preferences (reorder from current: Company, Users, Bank Accounts, BAS Categories, VAT Registrations). Drop the placeholder "Users" tab (not implemented)

- [x] Task 8: UI — Personal Locale settings (AC: #4, #6)
  - [x] 8.1 Create route `src/app/(app)/settings/my-preferences/page.tsx` — server component that fetches user preferences, uses `authedAction` (any role, not owner-only)
  - [x] 8.2 Create `src/components/settings/my-preferences-tab.tsx` — client component with:
    - Locale selector (Select component) showing supported locales with human-readable display names (e.g., "Svenska (sv-SE)", "English US (en-US)", "Francais (fr-FR)")
    - **Live preview** below selector showing date and number formatting in selected locale (e.g., sv-SE: "2026-03-12" / "12 500,00" vs en-US: "Mar 12, 2026" / "12,500.00"). This is critical UX — don't bury in subtask
    - Auto-save on selection change (onChange pattern, not onBlur)
    - Success is silent, error shows toast
  - [x] 8.3 Add "My Preferences" tab to settings page navigation in `src/app/(app)/settings/page.tsx` (see Task 7.3 for tab organization)

- [x] Task 9: Tests (AC: all)
  - [x] 9.1 Create `src/server/services/document-type-prefixes.test.ts` with tests for:
    - CRUD full cycle via `assertCrudOperations` pattern
    - **Seed-on-first-access**: fresh tenant → action seeds defaults → `getDocumentTypePrefixes` returns 5 defaults; calling again returns same records (idempotent, no duplicates)
    - **Delete-all-reseed prevention** (critical): seed defaults → delete ALL 5 prefixes → call get again → verify returns EMPTY array (NOT re-seeded). The `prefixes_seeded` TenantConfig flag prevents re-seeding after deliberate deletion
    - Duplicate prevention (same documentType for same tenant → DUPLICATE_ENTRY)
    - Prefix format validation edge cases: empty → reject, just `_` → reject, `EXP_` → auto-lowercased to `exp_`, `exp` (no trailing `_`) → reject, `exp__` → reject, `ärk_` (unicode) → reject, `abcdefghij_` (10 chars) → accept, `abcdefghijk_` (11 chars) → reject
    - RLS isolation via `assertRlsIsolation`
    - Audit logging via `assertAuditLogged`
  - [x] 9.2 Create `src/server/services/user-preferences.test.ts` with tests for:
    - Get/update locale preference
    - Locale validation: reject unsupported locales (e.g., `xx-YY`), accept all `SUPPORTED_LOCALES`
    - User isolation (user A cannot read/update user B's preferences — application-level enforcement, not RLS)
    - Null locale returns null (meaning "use browser locale")
  - [x] 9.3 Create `src/lib/format-date.test.ts` and `src/lib/format-number.test.ts` — **pure function tests only** (Vitest server, no React Testing Library needed). Test every supported locale produces valid `Intl` output. Test edge cases: negative amounts, zero, large numbers, `formatDate` with sv-SE vs en-US vs fr-FR producing expected date strings. Test `resolveLocale()` fallback behavior. Do NOT unit-test `LocaleProvider` React context — it's trivial (`useState` + `createContext`); future E2E tests will implicitly verify locale propagation
  - [x] 9.4 Test server actions RBAC: ownerAction for document-type prefixes, authedAction for user locale

- [x] Task 10: Documentation (AC: #7)
  - [x] 10.1 Create `docs/document-type-prefixes.md` documenting the prefix system, default values, business key pattern, and how prefixes are used in document generation
  - [x] 10.2 Create `docs/user-preferences.md` documenting locale preferences, supported locales, and how formatting works
  - [x] 10.3 Update `docs/index.md` with links to new docs

## Dev Notes

### Architecture Patterns & Constraints

- **Hexagonal architecture**: actions → services → db. Services MUST NOT import from `next/*` or `src/components/*`
- **Server Actions never throw** — return `{ error: AppError }` inside data
- **Document-type prefixes are tenant-level** → `ownerAction` for all CRUD
- **Locale preference is user-level** → `authedAction` (any authenticated user sets their own)
- **Auto-save UX**: text fields save onBlur, select fields save onChange. Silent success, inline error on failure. Optimistic updates with error rollback
- **Money stays as Decimal** until component display boundary — locale formatting applies only at display
- **Dates**: `TIMESTAMPTZ` in DB, ISO 8601 in code, locale-formatted at display boundary via `Intl.DateTimeFormat`
- **Never hardcode sv-SE** for locale — use user's stored preference or browser locale as fallback (per user feedback)

### Two-Part Story Structure

This story has two distinct parts with different scoping:

1. **Document-Type Prefixes** (tenant-scoped, owner-only):
   - New Prisma model `DocumentTypePrefix` with RLS
   - Full CRUD service + actions + UI tab
   - Follows the same pattern as `VatRegistration` (Story 3.2) and `BankAccount` (Story 3.3)
   - Default prefixes auto-seeded on first access (no tenant-creation hook)
   - Document types are free-form strings — the prefix table IS the configurable type registry

2. **Personal Locale** (user-scoped, any authenticated user):
   - New `UserPreference` model in `app.prisma` (NOT `auth.prisma`) — NO RLS needed (user-scoped)
   - Simple get/update service + actions
   - Select-based UI with live preview
   - `LocaleProvider` React context for app-wide formatting

### Key Design Decisions (Locked)

1. **Seed-on-first-access with read/write separation** — `getDocumentTypePrefixes()` is a pure read. `seedDocumentTypePrefixes()` is a separate mutation that receives `AuditLogger` and logs each seeded prefix. Action layer orchestrates: check `prefixes_seeded` TenantConfig flag → seed if needed → return results. A `prefixes_seeded` boolean flag in `TenantConfig` prevents the delete-all-then-reseed bug (user deletes all prefixes → they stay deleted, not re-seeded)
2. **`UserPreference` in `app.prisma`** (not `auth.prisma`) — separate model with `userId` FK. Avoids Better Auth migration conflicts on upgrades. First user-scoped (not tenant-scoped) entity in the system — deliberate exception, not a pattern to replicate
3. **Infrastructure only, no retrofit** — `formatDate`/`formatNumber` + `LocaleProvider` created but existing date displays NOT retrofitted. Future stories adopt organically when their components are built
4. **Free-form document types** — no enum. The prefix table IS the configurable document type registry. Users can create types (e.g., `tax_`) before Epic 5 lands
5. **Tab naming + role-based visibility** — "Document Prefixes" + "My Preferences". Settings page implements role-based tab filtering: owner sees all tabs, accountant sees only "My Preferences". Sidebar nav updated to allow `["owner", "accountant"]` access to `/settings`
6. **Server/client locale flow** — `layout.tsx` fetches locale server-side → hydrates `LocaleProvider` → client components use `useLocale()` hook → server components accept `locale` as explicit prop. Locale fallback chain: stored preference → browser locale → `sv-SE`
7. **Prefix validation** — regex `/^[a-z0-9]+_$/`, enforce lowercase via Zod `.toLowerCase()`, max 10 chars. Illustrative business key preview shown next to each prefix in UI
8. **`formatNumber` vs `formatCurrency` separation** — `formatNumber()` (new) is for non-monetary values only (quantities, percentages). Currency amounts MUST use existing `formatCurrency()` from `src/lib/format-currency.ts` which follows currency-specific conventions, NOT user locale. Architecture rule: "Currency formatting follows the currency's convention, not the user's locale"
9. **Locale upsert semantics** — `updateUserLocale()` uses Prisma `upsert` (create-if-not-exists, update-if-exists). First selection creates `UserPreference` row. Pass `null` to reset to browser default
- **Locale stored as BCP 47 tag** (e.g., "sv-SE", "en-US") — standard format used by `Intl` APIs directly
- **`source` field on UserPreference** defaults to `"manual"` — included per mandatory template convention. User preferences are always manual, so this field is constant but required for template compliance

### Anti-Pattern Warnings

- **`user_preferences` table MUST NOT have an RLS policy.** Do NOT follow the "every table gets RLS" pattern for this model. It is user-scoped (keyed by `userId`), not tenant-scoped. The `authedAction` middleware still calls `SET LOCAL app.tenant_id` — this is harmless because no RLS policy exists on this table to filter by it. Migration SQL must include explicit comment: `-- NO ROW LEVEL SECURITY on user_preferences (user-scoped, not tenant-scoped)`
- **Do NOT use `withTenantTransaction` to query `UserPreference`.** This is user-scoped data, not tenant-scoped. Use direct `prisma.userPreference.findUnique({ where: { userId } })`. In `layout.tsx`, this is the first non-tenant query — do not wrap it in the tenant transaction pattern
- **Do NOT define a Prisma `@relation` on `UserPreference.userId`.** The auth user model lives in a separate schema file (`auth.prisma`). Use a plain `String @unique @db.Uuid` field with application-level enforcement, same as `AuditLog.userId`
- **Do NOT use `formatNumber()` for currency amounts.** Currency formatting uses `formatCurrency()` which follows currency conventions (SEK space-thousands, CHF apostrophe-thousands), NOT user locale. This is an architectural invariant
- **Do NOT rename existing `formatDateTime()`/`formatDateShort()` functions** in `format-date.ts`. Add `formatDate()` alongside them. No breaking changes to existing imports

### Downstream Consumers

- **Epic 5 (Document Management)**: Story 5.1 will use `getDocumentTypePrefixes()` to generate business keys when uploading documents. Pattern: `[prefix]YYYYMMDD_[BAS-short]_[Partner]_NNN.ext`
- **Epic 6 (Banking)**: Journal entry business keys (`JE-YYYY-MM-NNN`) are separate from document prefixes but follow similar generation pattern
- **Epic 10 (Invoicing)**: Invoice numbering (`INV-YYYY-NNN`) may reference the `inv_` prefix or use its own counter

### Previous Story Intelligence (from Story 3.3)

- **Auto-save UX pattern**: text fields onBlur via `useAction()` + `executeAsync`, select fields onChange. Toast only on error; success is silent. Optimistic updates with error rollback
- **`actionError()` helper** from `vat-registrations-tab.tsx` for extracting error messages from action results — reuse this
- **Test helpers**: `assertRlsIsolation`, `assertAuditLogged`, `assertCrudOperations` from `src/server/test-utils/config-crud-helpers.ts`
- **Zod schema ordering**: trim before length, toUpperCase where applicable
- **Delete pattern**: hard delete with confirmation dialog, no soft delete. Add TODO comment for future downstream reference checks
- **Card-based list UI** with inline editing — established pattern for settings items

### Git Intelligence (Recent Commits)

Recent work (Story 3.3 bank accounts) established:
- Two-model pattern (app-level + tenant-level) — Story 3.4 only needs tenant-level
- PostgreSQL RULE-based immutability for app-level data — not needed for Story 3.4
- Migration pattern with RLS policy, audit trigger, and GRANT/REVOKE
- Service layer with CallerIdentity + AuditLogger + ServiceResult pattern
- `ownerAction` for tenant-private CRUD operations

### Project Structure Notes

- New files align with existing structure:
  - `src/server/services/document-type-prefixes.ts` (1:1 with action file)
  - `src/server/actions/document-type-prefixes.ts`
  - `src/components/settings/document-type-prefixes-tab.tsx`
  - `src/app/(app)/settings/document-prefixes/page.tsx`
  - `src/server/services/user-preferences.ts`
  - `src/components/settings/my-preferences-tab.tsx`
  - `src/app/(app)/settings/my-preferences/page.tsx`
  - `src/components/providers/locale-provider.tsx`
  - `src/lib/format-date.ts`
  - `src/lib/format-number.ts`
- No barrel exports — direct imports only
- Tests co-located: `.test.ts` next to service files

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.4]
- [Source: _bmad-output/planning-artifacts/architecture.md — D3: Server Action Organization, D4: Error Response Shape, Prisma Model Template, Configuration Dependency Graph]
- [Source: _bmad-output/planning-artifacts/prd.md — FR41: Document-type prefixes, FR44: Personal locale]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Settings page architecture, auto-save pattern, form field specifications, locale display rules]
- [Source: src/server/actions/settings.ts — ownerAction pattern]
- [Source: src/server/services/settings.ts — service layer pattern with CallerIdentity]
- [Source: src/components/settings/bank-accounts-tab.tsx — card-based CRUD UI pattern]
- [Source: src/components/settings/vat-registrations-tab.tsx — auto-save + actionError helper]
- [Source: src/server/test-utils/config-crud-helpers.ts — assertRlsIsolation, assertAuditLogged, assertCrudOperations]
- [Source: src/lib/constants.ts — CURRENCIES, add SUPPORTED_LOCALES and DEFAULT_DOCUMENT_TYPE_PREFIXES]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed — comprehensive developer guide created
- Task 1-2: Created DocumentTypePrefix (tenant-scoped, RLS) and UserPreference (user-scoped, NO RLS) models with migration
- Task 3-5: Implemented service layer and server actions for both models following established patterns
- Task 6: Added formatDate(), formatNumber(), resolveLocale() utilities and LocaleProvider React context
- Task 7-8: Built Document Prefixes tab (card-based CRUD with seed-on-first-access) and My Preferences tab (locale selector with live preview)
- Settings page converted to async server component with role-based tab filtering
- Task 9: 306 tests all passing — 59 new tests (21 prefix service, 11 user preferences, 27 format utilities)
- Task 10: Documentation with wiki-links for document-type prefixes and user preferences

### Senior Developer Review (AI)

**Reviewer:** Zik — 2026-03-13
**Outcome:** Approved with fixes applied

**Findings (7 total — 1 High, 3 Medium, 3 Low):**

1. **HIGH — Manual AuditLogger via dynamic import in page:** Replaced with static `createAuditEntry` import. Extracted `getDocumentTypePrefixesWithSeed()` composite service method.
2. **MEDIUM — Duplicated seed orchestration:** Action and page both had check→seed→get logic. Consolidated into single service method used by both.
3. **MEDIUM — Uncommitted Biome formatting:** 8 files had unstaged formatting changes. Applied and committed.
4. **MEDIUM — Silent seed failure in page:** Seed errors were ignored. Now propagated via composite method's ServiceResult.
5. **LOW — Missing visual separator:** Added `border-l` separator before "My Preferences" tab to visually separate user-scoped from tenant-scoped settings.
6. **LOW — Preview number without decimals:** Added `minimumFractionDigits: 2` so preview shows "12,500.00" / "12 500,00" as spec requires.
7. **LOW — Unsafe type assertion:** Replaced `as` cast with runtime `SUPPORTED_LOCALES.includes()` check before passing locale to action.

All findings fixed in commit `b28a720`.

### Change Log

- 2026-03-13: Story 3.4 implementation complete — all 10 tasks, all ACs satisfied
- 2026-03-13: Code review — 7 findings fixed (1H, 3M, 3L), status → done

### File List

New files:
- prisma/migrations/20260313200000_add_document_type_prefixes_and_user_locale/migration.sql
- src/server/services/document-type-prefixes.ts
- src/server/services/user-preferences.ts
- src/server/actions/document-type-prefixes.ts
- src/server/actions/user-preferences.ts
- src/lib/format-number.ts
- src/components/providers/locale-provider.tsx
- src/components/settings/document-type-prefixes-tab.tsx
- src/components/settings/my-preferences-tab.tsx
- src/app/(app)/settings/document-prefixes/page.tsx
- src/app/(app)/settings/my-preferences/page.tsx
- src/server/services/document-type-prefixes.test.ts
- src/server/services/user-preferences.test.ts
- src/lib/format-number.test.ts
- docs/document-type-prefixes.md
- docs/user-preferences.md

Modified files:
- prisma/schema/app.prisma (added DocumentTypePrefix and UserPreference models)
- src/lib/constants.ts (added DEFAULT_DOCUMENT_TYPE_PREFIXES, SUPPORTED_LOCALES, updated settings roles)
- src/lib/format-date.ts (added resolveLocale(), formatDate())
- src/app/(app)/layout.tsx (added LocaleProvider with server-side locale fetch)
- src/app/(app)/settings/page.tsx (converted to async, role-based tab filtering)
- src/lib/format-date.test.ts (added resolveLocale and formatDate tests)
- src/lib/nav-filter.test.ts (updated for accountant Settings access)
- docs/index.md (added links to new docs)
