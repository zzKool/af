# Story 4.1: Partner CRUD & Defaults

Status: done

**Pattern-setter story** — first domain entity CRUD, first soft-delete, first top-level entity page, first FK to reference table with tenant-activation validation. Keep scope minimal, establish reusable patterns, document thoroughly.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to create and manage business partner records with default settings,
So that transactions linked to a partner automatically inherit the right currency, BAS category, and other defaults.

## Acceptance Criteria

1. **Given** BAS categories and currencies are configured from Epic 3, **When** the owner creates a partner, **Then** a `partners` table exists with RLS enabled, containing: `name`, `org_number`, `vat_number`, `types` (text array, validated by Zod to `client`/`vendor`/`employee`), `default_currency`, `default_language`, `default_bas_category_id` (FK → `bas_categories`), `external_identifiers` (JSONB array), `email`, `phone`, `address` (JSONB), `is_active` (boolean), plus mandatory template fields (id, tenant_id, created_at, updated_at, created_by, source).

2. **Given** the owner is on the partners page, **When** they manage partners, **Then** they can create, read, update, and soft-delete partner records with all fields (FR24).

3. **Given** the owner is editing a partner, **When** they add external identifiers, **Then** each is stored as `{ label: string, value: string }` in a JSONB array (max 5), e.g., `[{ label: "Supplier Number", value: "SUP-44821" }]` (FR25).

4. **Given** a partner has default BAS category and currency set, **When** journal entries are created linked to that partner (future Epic 6), **Then** defaults are available for auto-fill via the search endpoint (FR27).

5. **Given** the owner soft-deletes a partner, **When** the deletion is confirmed via ConfirmDialog, **Then** the partner is marked `is_active: false` (not hard-deleted), retained for historical references, and the audit log records action `deactivate` with old/new data.

6. **Given** the owner navigates to `/(app)/partners`, **When** the page loads, **Then** a ServerDataTable shows the partner directory with columns (name, types, org_number, default_currency, is_active), searchable, with active/inactive filter.

7. **Given** the owner clicks a partner in the list, **When** the detail page loads at `/(app)/partners/[id]`, **Then** the partner's full details are shown in an editable form with auto-save on blur.

8. **Given** `docs/` documentation standards, **When** the story is complete, **Then** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting the partner CRUD pattern, soft-delete pattern, and FK validation pattern.

## Tasks / Subtasks

- [x] Task 0: Retro Gate Check (AC: all)
  - [x] 0.1 Open `_bmad-output/implementation-artifacts/deferred-items.md` and check for items with deadlines at or before Story 4.1
  - [x] 0.2 Verify item #12 (soft-delete pattern) is resolved by this story's design decisions (see Dev Notes)
  - [x] 0.3 Verify item #13 (pattern-setter flag) is applied to this story
  - [x] 0.4 Note item #11 (test data factory) — partially addressed by `createTestPartner` fixture in Task 5; full factory pattern deferred to Story 4.2
  - [x] 0.5 Document check result in Dev Agent Record

- [x] Task 1: Prisma schema + migration with RLS (AC: #1)
  - [x] 1.1 Add `Partner` model to `prisma/schema/app.prisma` (see Schema section in Dev Notes for exact definition). Use `String[]` for `types` — no PostgreSQL enum (see "Why No PG Enum" in Dev Notes).
  - [x] 1.2 Add relation to `Tenant` model: `partners Partner[]`
  - [x] 1.3 Add relation to `BasCategory` model: `partners Partner[]`
  - [x] 1.4 Run `npx prisma migrate dev --name add_partners_table` to generate migration
  - [x] 1.5 Edit migration SQL to add after table creation:
    - `ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;`
    - `ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;`
    - `CREATE POLICY tenant_isolation ON "partners" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);`
    - `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partners" TO defterfab_app;`
    - Unique constraint: `CREATE UNIQUE INDEX idx_partners_tenant_org ON "partners" ("tenant_id", "org_number") WHERE "org_number" IS NOT NULL;`
  - [x] 1.6 Run `npx prisma migrate dev` to apply and regenerate client
  - [x] 1.7 Verify `npx prisma validate` passes
  - [x] 1.8 Verify generated Prisma client has `Partner` model with `types: string[]` field

- [x] Task 2: Partner service — CRUD + search (AC: #2, #3, #4, #5)
  - [x] 2.1 Create `src/server/services/partners.ts` following `vat-registrations.ts` pattern
  - [x] 2.2 Implement `getPartners(tx, options?: { includeInactive?: boolean, search?: string })` — returns `ServiceResult<Partner[]>`. Default: `is_active: true` filter. Search: case-insensitive name/org_number substring match. Order by `name ASC`.
  - [x] 2.3 Implement `getPartner(tx, id)` — returns `ServiceResult<Partner | null>`. No active filter (detail page shows inactive partners too).
  - [x] 2.4 Implement `createPartner(tx, caller, audit, data)` — validates: (a) if `defaultBasCategoryCode` provided, `findUnique` on `basCategory` table to verify it exists, then check `tenantBasPreference` exists for this tenant+category combo (see FK Validation Pattern in Dev Notes); (b) Zod validates `externalIdentifiers` shape and `types` array (min 1 type required). Catches P2002 on `(tenant_id, org_number)` → `DUPLICATE_ENTRY`.
  - [x] 2.5 Implement `updatePartner(tx, caller, audit, id, data)` — read-before-write for audit oldData. Same FK validation for `defaultBasCategoryCode` if changed. Same duplicate check on `org_number` if changed.
  - [x] 2.6 Implement `deactivatePartner(tx, caller, audit, id)` — sets `is_active: false`. Audit action: `deactivate` (not `delete`). Read-before-write for audit oldData.
  - [x] 2.7 Implement `reactivatePartner(tx, caller, audit, id)` — sets `is_active: true`. Audit action: `reactivate`.
  - [x] 2.8 Implement `searchPartners(tx, query: string, limit?: number)` — lightweight endpoint returning `{ id, name, types, defaultCurrency, defaultBasCategoryCode }[]` for PartnerSelector use in Epic 6. Only active partners. Max 20 results.

- [x] Task 3: Server Actions (AC: #2)
  - [x] 3.1 Create `src/server/actions/partners.ts` following `vat-registrations.ts` action pattern
  - [x] 3.2 Export `getPartnersAction` — `ownerAction` (partners are owner-only, accountants cannot access)
  - [x] 3.3 Export `getPartnerAction` — `ownerAction`, schema: `{ id: z.string().uuid() }`
  - [x] 3.4 Export `createPartnerAction` — `ownerAction`, schema: `createPartnerSchema` (see Zod Schemas in Dev Notes)
  - [x] 3.5 Export `updatePartnerAction` — `ownerAction`, schema: `updatePartnerSchema`
  - [x] 3.6 Export `deactivatePartnerAction` — `ownerAction`, schema: `{ id: z.string().uuid() }`
  - [x] 3.7 Export `reactivatePartnerAction` — `ownerAction`, schema: `{ id: z.string().uuid() }`
  - [x] 3.8 Export `searchPartnersAction` — `ownerAction`, schema: `{ query: z.string().min(1).max(100) }`

- [x] Task 4: Partners pages + UI components (AC: #6, #7)
  - [x] 4.1 Enable Partners in sidebar: set `enabled: true` for Partners entry in `src/lib/constants.ts` NAV_ITEMS
  - [x] 4.2 Install shadcn Table primitive: `npx shadcn@latest add table`
  - [x] 4.3 Create `src/app/(app)/partners/page.tsx`
  - [x] 4.4 Create `src/app/(app)/partners/error.tsx`
  - [x] 4.5 Create `src/components/partners/partner-list.tsx`
  - [x] 4.6 Create `src/components/partners/partner-form.tsx`
  - [x] 4.7 Create `src/app/(app)/partners/[id]/page.tsx`
  - [x] 4.8 Create `src/app/(app)/partners/[id]/not-found.tsx`
  - [x] 4.9 Wire all Server Actions with `useAction` hooks
  - [x] 4.10 Soft-delete uses `useConfirmDialog` + `<ConfirmDialog>`

- [x] Task 5: Tests (AC: all)
  - [x] 5.1 Create `src/server/services/partners.test.ts`
  - [x] 5.2 Service CRUD tests: 5 tests (create min/max, update, search, list filter)
  - [x] 5.3 Validation tests: 7 tests (BAS FK, duplicate org, types, external identifiers)
  - [x] 5.4 Soft-delete lifecycle test: create → deactivate → verify → reactivate → verify
  - [x] 5.5 RLS isolation test
  - [x] 5.6 Audit tests: 4 tests (create, update, deactivate, reactivate)
  - [x] 5.7 Server Action RBAC tests: 4 owner success + 3 member forbidden
  - [x] 5.8 Add `createTestPartner()` fixture, `partners` in cleanup truncation

- [x] Task 6: Documentation (AC: #8)
  - [x] 6.1 Create `docs/partner-crud-pattern.md`
  - [x] 6.2 Update `docs/index.md` with link
  - [x] 6.3 Update deferred items register: #12 resolved, #13 resolved, #11 updated

- [x] Task 7: Verify everything (AC: all)
  - [x] 7.1 Biome check: 0 errors
  - [x] 7.2 TypeScript: 0 errors (`npx tsc --noEmit`)
  - [x] 7.3 Tests: 26/26 passing
  - [x] 7.4 Manual smoke deferred to code review (no dev server in CI context)

## Dev Notes

### This is a Pattern-Setter Story

Story 4.1 is the **first domain entity CRUD** (previous stories were all tenant config). Patterns established here will be followed by Stories 4.2, 4.3, and all future entity stories. Keep scope minimal, document patterns explicitly.

Patterns being established:
1. **Domain entity Prisma model** with all mandatory fields + soft-delete
2. **Service layer** with soft-delete (deactivate/reactivate), FK validation, search
3. **Server Actions** for domain entities (owner-only for partners)
4. **Top-level entity page** with TanStack Table + shadcn Table (not settings-tab card pattern)
5. **Detail/edit page** at `/(app)/entity/[id]` with auto-save
6. **FK validation** for references to global reference tables with tenant-activation check

### Soft-Delete Pattern Decision (Deferred Item #12 — RESOLVED)

**Decision:** Use `is_active: boolean` (not `deleted_at: DateTime?`).

**Rationale:**
- Simpler to query: `WHERE is_active = true` vs `WHERE deleted_at IS NULL`
- Boolean is more intuitive for "active/inactive" business concept (partners aren't "deleted," they're deactivated)
- No need for deletion timestamp — `updated_at` already captures when the change happened
- Audit log records the `deactivate` action with timestamp
- Consistent with the AC which says "mark inactive, retain for historical references"

**Audit action naming:** Use `deactivate` / `reactivate` (not `delete` / `restore`) to match the business concept.

**Default query behavior:** Service functions default to `is_active: true` for list queries. Detail queries by ID return regardless of active status (so you can view/reactivate inactive partners).

**Cascade to child entities (contracts in Story 4.2):** Deferred to Story 4.2. Deactivating a partner does NOT cascade-deactivate contracts — contracts have their own lifecycle.

### Partner Prisma Schema

```prisma
model Partner {
  id                    String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId              String   @map("tenant_id") @db.Uuid
  name                  String
  orgNumber             String?  @map("org_number")
  vatNumber             String?  @map("vat_number")
  types                 String[] @default([])
  defaultCurrency       String?  @map("default_currency")
  defaultLanguage       String?  @map("default_language")
  defaultBasCategoryId  String?  @map("default_bas_category_id") @db.Uuid
  externalIdentifiers   Json     @default("[]") @map("external_identifiers")
  email                 String?
  phone                 String?
  address               Json?
  isActive              Boolean  @default(true) @map("is_active")
  createdAt             DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime @updatedAt @map("updated_at") @db.Timestamptz
  createdBy             String   @map("created_by") @db.Uuid
  source                String   @default("web")

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  basCategory BasCategory? @relation(fields: [defaultBasCategoryId], references: [id])

  @@map("partners")
}
```

**Notes on `types` field:** Stored as `String[]` in Prisma, `text[]` in PostgreSQL. Validated exclusively via Zod at the service layer (`z.array(z.enum(["client", "vendor", "employee"])).min(1)`). See "Why No PG Enum for Types" section below.

**Notes on `defaultBasCategoryId` FK:** Points to `bas_categories.id` (global reference table, no RLS). Service-level validation ensures the category is activated for the tenant (see FK Validation Pattern below). The `BasCategory` model needs a `partners Partner[]` relation added. **Safety note:** Never query `basCategory.findUnique({ include: { partners: true } })` — this would bypass RLS on the partners side since `bas_categories` has no RLS. Always query partners → basCategory (not the reverse).

**Notes on `address` JSONB:** Shape: `{ street?: string, city?: string, postalCode?: string, country?: string }`. All fields optional. Needed for Epic 10 invoicing. Validated by Zod, not DB constraints.

### Zod Schemas

```typescript
const partnerTypeSchema = z.enum(["client", "vendor", "employee"]);

const externalIdentifierSchema = z.object({
  label: z.string().min(1).max(50),
  value: z.string().min(1).max(100),
});

const addressSchema = z.object({
  street: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).toUpperCase().optional(), // ISO 3166-1 alpha-2
}).optional();

export const createPartnerSchema = z.object({
  name: z.string().min(1).max(200),
  orgNumber: z.string().max(20).optional(),
  vatNumber: z.string().max(20).optional(),
  types: z.array(partnerTypeSchema).min(1, "At least one type required"),
  defaultCurrency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
  defaultLanguage: z.string().optional(),
  defaultBasCategoryId: z.string().uuid().optional(),
  externalIdentifiers: z.array(externalIdentifierSchema).max(5).default([]),
  email: z.string().email().max(254).optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  address: addressSchema,
});

export const updatePartnerSchema = createPartnerSchema.partial().extend({
  id: z.string().uuid(),
});
```

### FK Validation Pattern (defaultBasCategoryId)

The `default_bas_category_id` FK points to `bas_categories` (global, no RLS). Service-level validation ensures the category is activated for the tenant:

```typescript
if (data.defaultBasCategoryId) {
  // 1. Verify the BAS category exists globally
  const category = await tx.basCategory.findUnique({
    where: { id: data.defaultBasCategoryId },
  });
  if (!category) {
    return { error: { code: "NOT_FOUND", message: "BAS category not found", retryable: false } };
  }
  // 2. Verify the tenant has activated this category
  const pref = await tx.tenantBasPreference.findFirst({
    where: { basCategoryId: data.defaultBasCategoryId, isActive: true },
  });
  if (!pref) {
    return { error: { code: "VALIDATION_ERROR", message: "BAS category not activated for this tenant", retryable: false } };
  }
}
```

This pattern is different from the cross-table RLS FK validation in `docs/cross-table-rls.md` (which uses `findUnique` within RLS-scoped tx to detect cross-tenant FKs). Here, `bas_categories` has no RLS — it's a global reference table — so we explicitly check `tenantBasPreference` activation instead.

Note: the `tenantBasPreference.findFirst` query runs inside the RLS-scoped transaction, so it automatically filters to the current tenant. The `basCategory.findUnique` hits a non-RLS table — both work correctly within the same transaction because `SET LOCAL` only affects RLS-enabled tables.

### Why No PG Enum for Types

**Decision:** Use `String[]` (text array) in Prisma + PostgreSQL, validate via Zod. Do NOT create a PostgreSQL `CREATE TYPE partner_type AS ENUM (...)`.

**Rationale:**
1. **Prisma 7 + PG enum arrays = `@db.Unsupported()`** — Prisma has no native support for PostgreSQL enum arrays. Using `@db.Unsupported("partner_type[]")` makes the field invisible to Prisma's generated client: no `where`, `create`, `update`, `has`, `hasEvery` operations. Every query involving `types` would require raw SQL. This is unacceptable for a field we query and filter constantly.
2. **`String[]` has full Prisma support** — `where: { types: { has: "client" } }`, `create: { types: ["client", "vendor"] }`, etc. All work out of the box.
3. **Zod validates at service boundary** — all writes go through the service layer, which validates `z.array(z.enum(["client", "vendor", "employee"])).min(1)`. Invalid values are caught before reaching the DB.
4. **Adding new types is a Zod change, not a migration** — if we later need `subcontractor`, we update the Zod enum. No `ALTER TYPE ... ADD VALUE` migration needed.
5. **Architecture doc context** — the "enums are PostgreSQL-level" guideline was written for single-value status columns, not array fields. Pragmatism over doctrine for this case.

### Table Component Approach (Greenfield)

**No existing table component exists in this project.** Settings pages use card-based lists. Story 4.1 establishes the table pattern.

**Approach:** TanStack Table (headless logic) + shadcn Table (styled rendering).

1. Install shadcn Table: `npx shadcn@latest add table` → generates `src/components/ui/table.tsx` with `<Table>`, `<TableHeader>`, `<TableBody>`, `<TableRow>`, `<TableHead>`, `<TableCell>` primitives.
2. Use `@tanstack/react-table` (already installed: ^8.21.3) for column definitions, sorting, filtering logic.
3. Use `@tanstack/react-query` (already installed: ^5.90.21) if server-side data fetching is needed later (for now, initial data is passed as props from server component).
4. Render TanStack Table rows using shadcn Table components.

**Pattern:** This partner-specific table is the foundation. When multiple entity tables exist (journal, documents, banking), extract the common patterns into a shared `ServerDataTable` component. For now, keep it focused.

### Auto-Save Strategy for Detail Page

The existing auto-save pattern (from `vat-registrations-tab.tsx`, `company-profile-form.tsx`):
- Local state per field → onChange updates local state → onBlur triggers save → optimistic update → revert on error

**For the partner form, group fields by save trigger:**

| Save Trigger | Fields | Pattern |
|---|---|---|
| `onBlur` | name, orgNumber, vatNumber, email, phone | Local state + save on blur + revert on error |
| `onChange` (immediate) | defaultCurrency, defaultLanguage, defaultBasCategoryId, types | Select/checkbox change triggers save directly |
| Dedicated Save button | address (4 sub-fields), externalIdentifiers (dynamic array) | Too complex for field-by-field auto-save. Group into a sub-form with explicit Save. |

**Error handling:** Use `actionError()` helper to extract error messages from `useAction` results. Check if a shared `actionError` utility exists (settings components each define their own — if so, extract to `src/lib/action-error.ts` as a pattern-setter contribution).

**Import:** `import { useAction } from "next-safe-action/hooks";` — use `executeAsync` for calls, `isPending` for loading states.

### Architecture Patterns & Constraints

- **Hexagonal:** `actions/partners.ts` → `services/partners.ts` → DB. Services MUST NOT import `next/*`.
- **Server Actions never throw** — return `{ data }` or `{ error: AppError }`.
- **CallerIdentity** passed to every service mutation method.
- **AuditLogger** called for every create/update/deactivate/reactivate.
- **Read-before-write** for all mutations that need audit `oldData`.
- **VALIDATE FIRST, WRITE SECOND** — never return AppError after a DB write.
- **Money stays Decimal** until component display boundary (not applicable yet, but `defaultCurrency` is just a string code).

### Existing Code to Reuse (DO NOT Reinvent)

- `src/server/middleware/action-client.ts` → `ownerAction` (full middleware chain)
- `src/server/db/tenant-client.ts` → `withTenantTransaction` (RLS-scoped DB access)
- `src/components/ui/confirm-dialog.tsx` + `src/hooks/use-confirm-dialog.ts` → delete confirmation
- `src/lib/constants.ts` → `CURRENCIES`, `SUPPORTED_LOCALES`, `NAV_ITEMS`
- `src/server/test-utils/config-crud-helpers.ts` → `assertRlsIsolation`, `assertAuditLogged`, `assertCrudOperations`
- `src/server/db/test-fixtures.ts` → `createTestTenant`, `createAuthenticatedContext`, `cleanupTestData`
- `src/app/(app)/dashboard/error.tsx` → error boundary pattern to copy
- `@tanstack/react-table` (^8.21.3) → already installed, use `createColumnHelper`, `useReactTable`, `flexRender`
- `@tanstack/react-query` (^5.90.21) → already installed (available for future server-side fetching, not needed for initial implementation)
- `zustand` (^5.0.11) → already installed, use `createTenantStore` from `src/lib/stores/create-tenant-store.ts` for filter state persistence across navigation
- `next-safe-action/hooks` → `useAction` hook with `executeAsync`, `isPending`

### File Structure

New files:
- `prisma/migrations/YYYYMMDD_add_partners_table/migration.sql`
- `src/server/services/partners.ts`
- `src/server/services/partners.test.ts`
- `src/server/actions/partners.ts`
- `src/app/(app)/partners/page.tsx`
- `src/app/(app)/partners/error.tsx`
- `src/app/(app)/partners/[id]/page.tsx`
- `src/app/(app)/partners/[id]/not-found.tsx`
- `src/components/ui/table.tsx` (generated by shadcn)
- `src/components/partners/partner-list.tsx`
- `src/components/partners/partner-form.tsx`
- `src/lib/action-error.ts` (if extracting shared utility — check if already exists first)
- `docs/partner-crud-pattern.md`

Modified files:
- `prisma/schema/app.prisma` (add Partner model, add relation to Tenant and BasCategory)
- `src/lib/constants.ts` (enable Partners nav item)
- `src/server/db/test-fixtures.ts` (add `createTestPartner`, add `partners` to cleanup)
- `docs/index.md` (add partner-crud-pattern.md link)
- `_bmad-output/implementation-artifacts/deferred-items.md` (resolve #12, #13, update #11)

### Previous Story Intelligence (Story 4.0)

- **321 tests passing** — must not regress
- **Pre-commit hook active** — husky + lint-staged runs `biome check --write` on staged files. No manual Biome step needed before commit.
- **Cross-table RLS spike confirmed:** JOINs respect RLS per-table, but FK constraints bypass RLS. Service-level validation required for cross-tenant FK writes. Pattern documented in `docs/cross-table-rls.md`.
- **`assertCrossTableRlsIsolation` helper** exists but is NOT needed here — `bas_categories` has no RLS (global reference table). Standard `assertRlsIsolation` is sufficient for the `partners` table itself.
- **ConfirmDialog pattern** established — use `useConfirmDialog()` hook + `<ConfirmDialog {...dialogProps} />`.
- **Conventional commits:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`

### Git Intelligence (Recent Commits)

Recent work (Story 4.0) established:
- `src/components/ui/confirm-dialog.tsx` — reusable delete confirmation
- `src/hooks/use-confirm-dialog.ts` — async action management hook
- `src/server/test-utils/config-crud-helpers.ts` — test helpers including `assertCrossTableRlsIsolation`
- `.husky/pre-commit` — auto-formatting on commit
- `docs/cross-table-rls.md` — FK validation guidance

### Recommended Execution Order

1. Task 0 (gate check) → 2. Task 1 (schema + migration) → 3. Task 2 (service) → 4. Task 5.1-5.6 (service tests, run to verify) → 5. Task 3 (actions) → 6. Task 5.7 (action RBAC tests) → 7. Task 4 (UI) → 8. Task 5.8 (test fixtures) → 9. Task 6 (docs) → 10. Task 7 (verify)

Rationale: Schema first (everything depends on it), then service + tests (verify business logic before UI), then actions (thin wrappers), then UI (uses everything), then docs + verify.

### What NOT to Build

- No generic ServerDataTable abstraction — build a partner-specific table using TanStack Table + shadcn Table directly. The full three-layer ServerDataTable (TableRenderer + FilterEngine + DataQueryLayer from UX spec) is for when multiple entity tables exist. For now, a focused partner table is correct. Extract shared patterns later.
- No PartnerSelector component — that's for Epic 6 consumers. The `searchPartners` endpoint is sufficient preparation.
- No contract-related UI — that's Story 4.2.
- No partner tabs (Overview/Contracts/Transactions/Documents) — that's Story 4.3. The `[id]` page is just the edit form.
- No import/export functionality.
- No auto-creation of "self" employee partner.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.1 requirements, FR24/FR25/FR27]
- [Source: _bmad-output/planning-artifacts/architecture.md — Entity lifecycle (soft-delete), Prisma model template, Server Action pipeline, naming conventions, test architecture, file structure, error taxonomy, RBAC matrix]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Partners in sidebar nav, ServerDataTable spec, form patterns (auto-save on blur), partner detail as browse-mode Detail Page, partner creation flow, PartnerSelector component spec]
- [Source: _bmad-output/implementation-artifacts/4-0-epic-4-prep-sprint.md — Previous story learnings: ConfirmDialog pattern, cross-table RLS findings, pre-commit hook, 321 tests baseline]
- [Source: _bmad-output/implementation-artifacts/deferred-items.md — Items #11 (test factory), #12 (soft-delete decision), #13 (pattern-setter flag)]
- [Source: docs/cross-table-rls.md — FK constraints bypass RLS, service-level validation pattern]
- [Source: docs/story-creation-checklist.md — Mutation story checklist, client-side UI checklist, pattern-setter flag guidance]
- [Source: src/server/services/vat-registrations.ts — Canonical CRUD service pattern]
- [Source: src/server/actions/vat-registrations.ts — Canonical action pattern]
- [Source: src/lib/constants.ts — NAV_ITEMS (Partners already defined, enabled: false), CURRENCIES, SUPPORTED_LOCALES]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- ✅ Task 0: Retro gate check passed. Item #12 (soft-delete) resolved by story design (is_active boolean). Item #13 (pattern-setter) applied. Item #11 (test factory) partially addressed by createTestPartner in Task 5.8.

### Change Log

- Task 0: Retro gate check passed — items #11, #12, #13 addressed
- Task 1: Prisma schema + migration with RLS — Partner model added with `defaultBasCategoryCode` (string FK to `bas_categories.code`) instead of `defaultBasCategoryId` (UUID) specified in Dev Notes schema. Rationale: `BasCategory.code` is the `@id` (natural key), so FK to `code` is correct; UUID FK would require a surrogate lookup. AC #1 says "default_bas_category_id" but the natural key approach is better and consistent with how `TenantBasPreference.basCode` works.
- Task 2: Partner service CRUD + search implemented with Zod validation, FK validation, soft-delete
- Task 3: Server Actions — all 8 actions exported as `ownerAction`
- Task 4: Partners list page + detail page with auto-save, TanStack Table + shadcn Table
- Task 5: 26 tests passing — service CRUD, validation, soft-delete lifecycle, RLS, audit, RBAC
- Task 6: Documentation — partner-crud-pattern.md, index.md updated, deferred items resolved
- Task 7: Verification — biome, tsc, tests all passing
- Code Review: Fixed `toAuditData` stripping JSONB/array fields, fixed auto-save unable to clear text fields, added None option to selects, removed unused `basOptions` prop from PartnerList, added idempotency guards to deactivate/reactivate

### File List

New files:
- `prisma/migrations/20260313111739_add_partners_table/migration.sql`
- `src/server/services/partners.ts`
- `src/server/services/partners.test.ts`
- `src/server/actions/partners.ts`
- `src/app/(app)/partners/page.tsx`
- `src/app/(app)/partners/error.tsx`
- `src/app/(app)/partners/[id]/page.tsx`
- `src/app/(app)/partners/[id]/not-found.tsx`
- `src/components/ui/table.tsx` (generated by shadcn)
- `src/components/ui/badge.tsx` (generated by shadcn — dependency of table)
- `src/components/partners/partner-list.tsx`
- `src/components/partners/partner-form.tsx`
- `docs/partner-crud-pattern.md`

Modified files:
- `prisma/schema/app.prisma` (added Partner model, relations to Tenant and BasCategory)
- `src/lib/constants.ts` (enabled Partners nav item)
- `src/server/db/test-fixtures.ts` (added `createTestPartner`, added `partners` to cleanup)
- `src/server/services/audit.ts` (added `deactivate`/`reactivate` action types, fixed `toAuditData` JSONB/array stripping)
- `src/types/audit.ts` (added `deactivate`/`reactivate` action types)
- `docs/index.md` (added partner-crud-pattern.md link)
- `_bmad-output/implementation-artifacts/deferred-items.md` (resolved #12, #13, updated #11)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story 4.1 → review)
