# Story 3.2: VAT Registration Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to manage my company's VAT registrations across multiple countries,
so that invoices and tax reports use the correct VAT numbers and rate schedules.

## Acceptance Criteria

1. **Given** the owner is logged in with tenant context
   **When** the owner navigates to `/(app)/settings/vat-registrations`
   **Then** a `vat_registrations` table exists with `tenant_id`, `country`, `vat_number`, and `rate_schedule` (JSONB), following the mandatory tenant model template (id, tenantId, createdAt, updatedAt, createdBy, source)

2. **Given** the VAT registrations table exists
   **When** the owner adds a new VAT registration
   **Then** the registration is created with country (ISO 3166-1 alpha-2), VAT number, and rate schedule, RLS-isolated to the tenant, and an audit log entry is written with `entityType: "vat_registration"`

3. **Given** the owner has existing VAT registrations (e.g., Swedish moms SE + Swiss MWST CH)
   **When** the owner views the VAT registrations page
   **Then** all registrations for the tenant are listed with country, VAT number, and rate schedule details

4. **Given** the owner has an existing VAT registration
   **When** the owner edits the registration (VAT number or rate schedule — country is immutable after creation)
   **Then** the changes are saved via auto-save pattern (onBlur for text fields), an audit log captures oldData/newData, and the UI reflects the update

5. **Given** the owner has an existing VAT registration
   **When** the owner removes a registration that is not referenced by existing records
   **Then** the registration is deleted, an audit log captures the old state, and it disappears from the list

6. **Given** the owner adds a VAT registration
   **When** the combination of country + VAT number already exists for this tenant
   **Then** a validation error is shown (DUPLICATE_ENTRY), the duplicate is not created

7. **Given** the owner adds or edits a rate schedule
   **When** multiple rates are provided (e.g., 25%, 12%, 6% for Swedish moms)
   **Then** the rates are stored as JSONB array in `rate_schedule`, validated by Zod schema, and displayed correctly in the UI

8. **Given** the story implementation is complete
   **When** new concepts, patterns, or configurations are introduced
   **Then** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting them

## Tasks / Subtasks

- [x] Task 0: Retro Gate Check (AC: prerequisite)
  - [x] 0.1 Check `_bmad-output/implementation-artifacts/deferred-items.md` — no items with deadlines at or before Story 3.2
  - [x] 0.2 Document check result in Dev Notes below

- [x] Task 1: Database Migration — vat_registrations table (AC: #1, #2)
  - [x] 1.1 Create Prisma migration with CREATE TABLE `vat_registrations`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `tenant_id UUID NOT NULL`, `country VARCHAR(2) NOT NULL` (ISO 3166-1 alpha-2), `vat_number VARCHAR(50) NOT NULL`, `rate_schedule JSONB`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `created_by UUID NOT NULL`, `source VARCHAR(20) NOT NULL DEFAULT 'web'`
  - [x] 1.2 Add `UNIQUE(tenant_id, country, vat_number)` constraint to prevent duplicate country+number per tenant
  - [x] 1.3 Enable RLS: `ALTER TABLE vat_registrations ENABLE ROW LEVEL SECURITY; ALTER TABLE vat_registrations FORCE ROW LEVEL SECURITY;`
  - [x] 1.4 Create tenant isolation policy matching existing pattern: `CREATE POLICY tenant_isolation ON vat_registrations USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`
  - [x] 1.5 `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE vat_registrations TO defterfab_app`
  - [x] 1.6 Add index: `(tenant_id)` — implicit via RLS scanning but explicit for query optimization
  - [x] 1.7 Add migration comment block explaining: what VAT registrations are, multi-country support, rate schedule JSONB structure

- [x] Task 2: Prisma Schema Update (AC: #1)
  - [x] 2.1 Add `VatRegistration` model to `prisma/schema/app.prisma` — follows mandatory template (id, tenantId, createdAt, updatedAt, createdBy, source), plus `country`, `vatNumber`, `rateSchedule` (Json? @db.JsonB)
  - [x] 2.2 Add `vatRegistrations VatRegistration[]` relation to existing `Tenant` model
  - [x] 2.3 Run `npx prisma generate` — verify client generation succeeds

- [x] Task 3: Service Layer (AC: #2, #3, #4, #5, #6, #7)
  - [x] 3.1 Create `src/server/services/vat-registrations.ts` with `ServiceResult<T>` return types. Import types: `TransactionClient` from `@/server/db/tenant-client`, `CallerIdentity` from `@/types/caller-identity`, `AuditLogger` from `@/types/audit`, `AppError` from `@/types/app-error`. Use `toAuditData()` from `@/server/services/audit` for audit data sanitization
  - [x] 3.2 Define `rateScheduleSchema` with Zod: `z.object({ rates: z.array(z.number().min(0).max(100)).min(1).max(10) }).strict()` — validates rate schedule shape (max 10 rates — no country exceeds 6 tiers, cap defensively)
  - [x] 3.3 `getVatRegistrations(tx: TransactionClient, caller: CallerIdentity)` — read-only, no `audit` param. Query `vat_registrations` (RLS-scoped by middleware). Return all registrations ordered by country, vatNumber
  - [x] 3.4 `createVatRegistration(tx: TransactionClient, caller: CallerIdentity, audit: AuditLogger, input: { country: string, vatNumber: string, rateSchedule?: { rates: number[] } })` — create row. Validate country is 2-char uppercase. Check for duplicates (unique constraint → catch Prisma P2002 → return DUPLICATE_ENTRY AppError). Audit log with `entityType: "vat_registration"`
  - [x] 3.5 `updateVatRegistration(tx: TransactionClient, caller: CallerIdentity, audit: AuditLogger, id: string, input: { vatNumber?: string, rateSchedule?: { rates: number[] } })` — update existing registration. **Country is immutable after creation** — not in update input. Read-before-write for audit oldData. Catch P2002 for duplicate country+vatNumber (vatNumber change could collide). Audit with `entityType: "vat_registration"`
  - [x] 3.6 `deleteVatRegistration(tx: TransactionClient, caller: CallerIdentity, audit: AuditLogger, id: string)` — DELETE registration. Read-before-delete for audit oldData. Add TODO comment: `// TODO: Epic 4/10 — check for partner/invoice/contract references before allowing delete`. No reference check needed yet (no downstream consumers in current schema). Audit with `entityType: "vat_registration"`
  - [x] 3.7 Ensure service MUST NOT import from `next/*` or `src/components/*`

- [x] Task 4: Server Actions (AC: #2, #3, #4, #5, #6, #7)
  - [x] 4.1 Create `src/server/actions/vat-registrations.ts`
  - [x] 4.2 `getVatRegistrations` — `ownerAction` with empty schema. Note: unlike BAS categories (which used `authedAction` for reference data), VAT registrations are tenant-private data so `ownerAction` is correct for reads too
  - [x] 4.3 `createVatRegistration` — `ownerAction` with schema `z.object({ country: z.string().length(2).toUpperCase().trim(), vatNumber: z.string().min(1).max(50).trim(), rateSchedule: rateScheduleSchema.optional() })`
  - [x] 4.4 `updateVatRegistration` — `ownerAction` with schema for id, vatNumber (`.trim()`), rateSchedule (all optional except id — **no country field**, country is immutable after creation)
  - [x] 4.5 `deleteVatRegistration` — `ownerAction` with schema `z.object({ id: z.string().uuid() })`
  - [x] 4.6 All actions use `ownerAction` — owner-only RBAC enforcement

- [x] Task 5: UI Component — VAT Registrations Tab (AC: #3, #4, #5, #6, #7)
  - [x] 5.1 Create `src/components/settings/vat-registrations-tab.tsx`
  - [x] 5.2 List view: display all registrations as cards/rows showing country flag/code, VAT number, and rate schedule (comma-separated percentages)
  - [x] 5.3 Add registration form: country code input (2-char uppercase, validated), VAT number input, rate schedule input (comma-separated numbers parsed to array). Use `useAction()` pattern from `src/components/domain/company-profile-form.tsx`. Rate input parser must be **lenient**: strip `%` signs, split on comma or space, ignore empty segments from trailing commas, trim whitespace. Extract as pure function `parseRateInput(raw: string): number[]` for testability
  - [x] 5.4 Inline edit: VAT number auto-save onBlur; rate schedule auto-save onBlur (parse → validate → save). **Country is read-only after creation** (displayed as text, not editable). Display parsed rates as clean `<Badge>` pills (e.g., `25%` `12%` `6%`) for visual confirmation. Show "No rates configured" when rate_schedule is null
  - [x] 5.5 Delete button per registration with confirmation (no undo — hard delete)
  - [x] 5.6 Error handling: toast.error on action failures (duplicate, validation). Success is silent (auto-save pattern)
  - [x] 5.7 Empty state: "No VAT registrations yet" with guidance text and "Add Registration" CTA
  - [x] 5.8 Optimistic updates: update local state immediately, revert on error (follow BAS categories pattern)
  - [x] 5.9 Use `actionError()` helper pattern from bas-categories-tab.tsx for extracting error messages

- [x] Task 6: Settings Page Integration (AC: #3)
  - [x] 6.1 Enable the VAT tab in `src/app/(app)/settings/page.tsx` — the existing tab uses `value="vat"` which must change to `value="vat-registrations"`. Remove `disabled` prop, add `nativeButton={false}` and `render={<Link href="/settings/vat-registrations" />}`, update label from "VAT (Coming soon)" to "VAT Registrations"
  - [x] 6.2 Create `src/app/(app)/settings/vat-registrations/page.tsx` — follow `settings/bas-categories/page.tsx` pattern: server component with `getAuthContext` + member role check + redirect non-owners to `/dashboard`, fetch initial data via `withTenantTransaction`, render `VatRegistrationsTab` client component with props
  - [x] 6.3 Ensure tab navigation works between Company, BAS Categories, and VAT Registrations

- [x] Task 7: Service & RLS Tests (AC: #1, #2, #3, #4, #5, #6, #7)
  - [x] 7.1 Create `src/server/services/vat-registrations.test.ts`
  - [x] 7.2 Use `assertRlsIsolation(prisma, "vatRegistration", tenantA.id, tenantB.id)` for tenant isolation
  - [x] 7.3 Use `assertAuditLogged(adminPool, tenantId, "create", "vat_registration")` for audit trail
  - [x] 7.4 Test create: add Swedish moms registration with rates [25, 12, 6], verify all fields stored
  - [x] 7.5 Test create multiple: add SE + CH registrations for same tenant, verify both returned
  - [x] 7.6 Test duplicate prevention: same country + vatNumber twice → DUPLICATE_ENTRY AppError (not throw)
  - [x] 7.7 Test update: change vatNumber, verify audit captures oldData/newData
  - [x] 7.8 Test update rate schedule: change rates array, verify stored correctly
  - [x] 7.9 Test delete: remove registration, verify audit captures old state
  - [x] 7.10 Test rate schedule validation: reject invalid shapes (empty rates array, rates > 100, negative rates, more than 10 rates)
  - [x] 7.11 Test country validation: reject non-2-char, non-uppercase values
  - [x] 7.12 Test create with null rate_schedule: `rateSchedule: undefined` → succeeds, stored as null in DB
  - [x] 7.13 Use `assertCrudOperations` from config-crud-helpers for a full create/read/update/delete cycle test
  - [x] 7.14 Test server actions: verify `ownerAction` RBAC enforcement (mock non-owner should fail)
  - [x] 7.15 Test `parseRateInput` pure function: `"25%, 12, 6,"` → `[25, 12, 6]`; `"25 12 6"` → `[25, 12, 6]`; `""` → `[]`; `"abc"` → `[]`

- [x] Task 8: Documentation & Cleanup (AC: all, #8)
  - [x] 8.1 Update `docs/index.md` with link to new VAT registrations doc
  - [x] 8.2 Create `docs/vat-registrations.md` with Obsidian-style `[[wiki-links]]`: VAT registration data model, multi-country support, rate schedule JSONB pattern (including future labeled-rates migration path), "no seeding" design decision, rate_schedule as selection convenience NOT source of truth, downstream consumers (Epic 4 contracts, Epic 10 invoicing, declaration exports). Follow `docs/bas-categories.md` heading structure for consistency
  - [x] 8.3 Add inline code comments documenting: rate schedule JSONB structure, multi-country design, downstream usage by invoices
  - [x] 8.4 Run `npx biome check --write` before each commit
  - [x] 8.5 Run full test suite: `npm run test` — all existing tests + new tests pass
  - [x] 8.6 Run `npm run lint` — clean

## Dev Notes

### Task Dependencies

Tasks must be executed in order due to dependencies:
- **Task 1 → Task 2**: Prisma schema must match the migration SQL
- **Task 2 → Tasks 3+4**: Services and actions need generated Prisma client
- **Tasks 3+4 → Task 5**: UI components consume the server actions
- **Task 5 → Task 6**: Settings page integration needs the component
- **Tasks 3-6 → Task 7**: Tests need all code written first
- **Tasks 7 → Task 8**: Docs after everything passes

### Pattern Reuse — Follow Story 3.1

This is the **second config CRUD page**. Story 3.1 (BAS Categories) established the patterns. This story is simpler (no reference table, no virtual list, no accordion — just tenant CRUD). Follow 3.1's patterns exactly:

| Aspect | Story 3.1 (BAS) | Story 3.2 (VAT) |
|--------|-----------------|-----------------|
| Reference table | Yes (bas_categories, no RLS) | No — VAT is purely tenant data |
| Tenant table | tenant_bas_preferences (sparse) | vat_registrations (full CRUD) |
| RLS | Yes, tenant_isolation policy | Yes, same pattern |
| Service params | `tx, caller, audit` | Same |
| Action type | ownerAction (writes), authedAction (reference reads) | ownerAction for ALL (tenant-private data) |
| UI pattern | Virtual list + accordion + auto-save | Simple list/cards + auto-save |
| Audit | entityType: "tenant_bas_preference" | entityType: "vat_registration" |

### Data Model Design

```prisma
// In prisma/schema/app.prisma — follows mandatory template
model VatRegistration {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  country      String   @db.VarChar(2)       // ISO 3166-1 alpha-2: "SE", "CH", "DE"
  vatNumber    String   @map("vat_number") @db.VarChar(50) // "SE556677889001", "CHE-123.456.789 MWST"
  rateSchedule Json?    @map("rate_schedule") @db.JsonB // { rates: [25, 12, 6] }
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz
  createdBy    String   @map("created_by") @db.Uuid
  source       String   @default("web")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, country, vatNumber])
  @@index([tenantId])
  @@map("vat_registrations")
}
```

### Rate Schedule JSONB Shape

```typescript
// Zod schema for validation
const rateScheduleSchema = z.object({
  rates: z.array(z.number().min(0).max(100)).min(1).max(10),
}).strict();

// Examples:
// Swedish moms: { rates: [25, 12, 6] }
// Swiss MWST: { rates: [8.1, 2.6, 3.8] }
// UK VAT: { rates: [20, 5, 0] }
```

Rates are stored as numbers (percentages). Money precision (Decimal) is NOT needed here — VAT rates are display/reference data, not monetary amounts. Actual VAT calculations in journal entries (Epic 6+) will construct Decimal from these numbers at computation time.

**CRITICAL: rate_schedule is a selection convenience, NOT the source of truth for applied rates.** Journal entries (Epic 6) MUST store the applied VAT rate as a snapshot on each entry, never reference rate_schedule dynamically. If a rate changes (e.g., Switzerland changed from 7.7% to 8.1% in 2024), historical entries must retain their original rate. Violating this would retroactively alter accounting records.

**Future migration path:** When Epic 10 (Invoicing) needs labeled rates for line-item selection, the shape may evolve from `[25, 12, 6]` to `[{value: 25, label: "Standard"}, {value: 12, label: "Food & hotels"}, ...]`. This is a non-breaking JSONB change at the service layer. Do NOT preemptively add labels now — delay until Epic 10 defines exact needs.

### Country Code — ISO 3166-1 Alpha-2

Use standard 2-character country codes: "SE" (Sweden), "CH" (Switzerland), "DE" (Germany), etc. Validate as exactly 2 uppercase ASCII letters. Do NOT build a full country picker/dropdown — a simple validated text input is sufficient for MVP. The epics file specifies only country code, not a country name field.

**Country is immutable after creation.** Users don't change a registration's country — they delete and re-add. This eliminates unique-constraint collision bugs on update and simplifies the service/action/UI. Country displays as read-only text on existing registration cards.

### Multi-Country Architecture Decision

Architecture doc states: "Multi-VAT registrations stored as a list from migration one — even if MVP UI focuses on single-country usage." The data model supports multiple registrations from day one. The UI should display all and allow add/edit/delete without limiting to a single country.

### Downstream Consumers

VAT registrations will be consumed by:
- **Epic 4 (Partners & Contracts)**: Contract VAT rules reference tenant's VAT registrations (FR26b)
- **Epic 10 (Invoicing)**: Invoice generation uses VAT rates from registrations (FR51-52)
- **Declaration exports**: Momsdeklaration filtering by VAT registration

Design the service API with these downstream consumers in mind, but do NOT build any integration points now. The `getVatRegistrations` service method will be reused by these future stories.

### Unique Constraint Design Choice

The unique constraint is `(tenant_id, country, vat_number)` — NOT just `(tenant_id, country)`. This allows:
- Multiple registrations per country (e.g., different VAT numbers for different business activities)
- Common case: one registration per country (SE moms, CH MWST)
- Edge case: same country, different registration numbers

### Auto-Save UX Pattern

Follow the auto-save pattern from Story 3.1:
- Text fields (vatNumber): save onBlur via `useAction()` + `executeAsync`. Country is read-only after creation
- Rate schedule: save onBlur (parse comma-separated string → number array → validate → save)
- Toast only on error; success is silent
- Optimistic updates with error rollback
- Display parsed rates as `<Badge>` pills (e.g., `25%` `12%` `6%`) for visual confirmation
- Show "No rates configured" when rate_schedule is null

### Rate Input Parser

Extract a pure function `parseRateInput(raw: string): number[]` for testability. Logic:
1. Strip `%` characters
2. Split on `/[,\s]+/` (comma or whitespace)
3. Filter empty segments (handles trailing commas)
4. `parseFloat` each segment
5. Filter `NaN` values
6. Return clean `number[]`

This lives in the component file (or a small util). The Zod schema in the action validates the final array (min 1, max 10, each 0-100).

### No Seeding

Unlike BAS categories (which seeded ~460 rows from official data), VAT registrations are **purely user-created**. No migration seed data. No quick-start button. VAT numbers are business-specific and cannot be pre-populated. Do NOT add any seed data for this table.

### Delete Safety

Currently NO downstream references exist to `vat_registrations`. Future stories (Epic 4, 10) will add foreign keys. For now, delete is unconditional (no reference check needed). Add a TODO comment in the `deleteVatRegistration` service method: `// TODO: Epic 4/10 — check for partner/invoice/contract references before allowing delete`. When downstream consumers are added, the delete service method should be updated to check for references before allowing deletion.

### Previous Story Intelligence (Story 3.1)

- **All tests passing** after Story 3.1 — must not regress
- Config CRUD helpers ready: `assertRlsIsolation`, `assertAuditLogged`, `assertCrudOperations` in `src/server/test-utils/config-crud-helpers.ts`
- Architecture guard tests enforce: no GRANT ALL, no console.*, no next/* in services
- `createTenantStore` factory available for Zustand state if needed
- **Migration safety**: always additive (new migration files), never edit applied migrations
- **Biome check before commit**: `npx biome check --write`
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`
- BAS tab code review feedback applied: toast error feedback, virtual list state lift, InlineField sync, quick-start error handling, TabsTrigger nativeButton fix — these patterns are already correct in the codebase
- **actionError() helper**: Extract from bas-categories-tab.tsx or define locally for consistent error extraction from action results

### Existing Constants (DO NOT duplicate)

`src/lib/constants.ts` already defines VAT-related constants:
```typescript
export const DEFAULT_VAT_RATE_SE = 25;
export const DEFAULT_VAT_RATE_CH = 7.7;
export const DEFAULT_VAT_RATE_SE_STR = "25";
export const DEFAULT_VAT_RATE_CH_STR = "7.7";
```
These are for journal entry calculations (Epic 6+). The rate_schedule JSONB on vat_registrations is the tenant-configurable version. Do NOT modify constants.ts for this story.

### Project Structure Notes

All paths follow project conventions:
- Services: `src/server/services/vat-registrations.ts` (kebab-case)
- Actions: `src/server/actions/vat-registrations.ts` (kebab-case)
- Components: `src/components/settings/vat-registrations-tab.tsx` (kebab-case file, PascalCase component: `VatRegistrationsTab`)
- Tests: co-located `src/server/services/vat-registrations.test.ts`
- Page: `src/app/(app)/settings/vat-registrations/page.tsx`
- Prisma schema: `prisma/schema/app.prisma` (existing file, add model)

### Mutation Story Checklist

- [x] RLS policy task — Task 1.3, 1.4
- [x] Specific GRANTs task — Task 1.5 (full CRUD for vat_registrations)
- [x] Audit log integration task — Task 3.4, 3.5, 3.6 (create/update/delete all audit-logged)
- [x] RLS isolation test — Task 7.2 (assertRlsIsolation)
- [x] Audit log test — Task 7.3 (assertAuditLogged)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2] — acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md] — multi-VAT data model, default resolution chain, config dependency graph
- [Source: _bmad-output/planning-artifacts/prd.md#FR38] — VAT registration functional requirement
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Journey 5] — settings one-time setup flow
- [Source: _bmad-output/implementation-artifacts/3-1-bas-category-management.md] — pattern-setter story (service, action, component, test patterns)
- [Source: src/server/test-utils/config-crud-helpers.ts] — reusable test helpers
- [Source: src/server/actions/settings.ts] — production server action pattern (ownerAction)
- [Source: src/server/services/bas-preferences.ts] — service layer pattern (ServiceResult, CallerIdentity, AuditLogger)
- [Source: src/components/settings/bas-categories-tab.tsx] — UI auto-save pattern (useAction, onBlur, optimistic updates, actionError)
- [Source: src/app/(app)/settings/bas-categories/page.tsx] — server component page pattern (auth + RBAC + data fetch + render)
- [Source: src/app/(app)/settings/page.tsx#L28-L30] — disabled VAT tab to enable
- [Source: src/lib/constants.ts] — existing VAT rate constants (do not duplicate)
- [Source: prisma/schema/app.prisma] — current schema with Tenant model to extend
- [Source: src/types/caller-identity.ts] — CallerIdentity type
- [Source: src/types/audit.ts] — AuditLogger interface
- [Source: src/types/app-error.ts] — AppError type and ErrorCode enum
- [Source: src/server/services/audit.ts] — createAuditEntry + toAuditData helpers
- [Source: docs/bas-categories.md] — established documentation pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No issues encountered during implementation.

### Completion Notes List

- All 8 tasks completed successfully with all subtasks checked
- 24 new tests added, all passing; 231 total tests pass (zero regressions)
- Followed Story 3.1 (BAS categories) patterns exactly for service/action/test structure
- Rate schedule JSONB validated by Zod; country validated as 2-char uppercase ISO 3166-1
- Country immutable after creation (read-only in UI, excluded from update schema)
- Delete includes TODO comment for future reference checks (Epic 4/10)
- Auto-save onBlur pattern with optimistic updates and error rollback
- ownerAction RBAC enforcement for all operations (unlike BAS which used authedAction for reads)

### Change Log

- 2026-03-12: Story 3.2 implementation complete — VAT registration CRUD with multi-country support
- 2026-03-12: Code review fixes — removed phantom ID fallback, fixed React key collision on rate badges, added registrations ref to avoid stale closures in update callbacks, reordered Zod schema (trim before length), documented undocumented file change (local-environment-setup.md)

### File List

- prisma/migrations/20260312141259_add_vat_registrations/migration.sql (new)
- prisma/schema/app.prisma (modified — added VatRegistration model + Tenant relation)
- src/server/services/vat-registrations.ts (new)
- src/server/actions/vat-registrations.ts (new)
- src/components/settings/vat-registrations-tab.tsx (new)
- src/app/(app)/settings/vat-registrations/page.tsx (new)
- src/app/(app)/settings/page.tsx (modified — enabled VAT tab with link)
- src/server/services/vat-registrations.test.ts (new)
- docs/vat-registrations.md (new)
- docs/local-environment-setup.md (modified — rewrote with step-by-step setup guide)
- docs/index.md (modified — added VAT registrations link)
