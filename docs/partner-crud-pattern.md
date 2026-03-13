# Partner CRUD Pattern

Canonical reference for domain entity CRUD — first implemented in Story 4.1 (Partners). All future domain entities (contracts, journal entries, documents) should follow this pattern.

## Overview

Partners are the first **domain entity** (vs config entities from Epic 3). Key differences from config entities:
- **Soft-delete** via `is_active` boolean (not hard-delete)
- **Top-level entity page** at `/(app)/partners` with list + detail sub-pages
- **FK to reference table** (`bas_categories`) with tenant-activation validation
- **Auto-save** on blur for text fields, onChange for selects

## Data Model

### partners Table

Follows the mandatory tenant model template (`id`, `tenantId`, `createdAt`, `updatedAt`, `createdBy`, `source`):

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | FK to tenants, RLS-scoped |
| `name` | TEXT | Partner display name (required) |
| `org_number` | TEXT | Swedish org number (optional) |
| `vat_number` | TEXT | VAT number (optional) |
| `types` | TEXT[] | Array: `client`, `vendor`, `employee` (Zod-validated) |
| `default_currency` | TEXT | ISO 4217 code (optional) |
| `default_language` | TEXT | BCP 47 tag (optional) |
| `default_bas_category_code` | TEXT | FK to `bas_categories.code` (optional) |
| `external_identifiers` | JSONB | `[{ label, value }]` array (max 5) |
| `email` | TEXT | Contact email (optional) |
| `phone` | TEXT | Contact phone (optional) |
| `address` | JSONB | `{ street, city, zip, country }` (optional) |
| `is_active` | BOOLEAN | Soft-delete flag (default `true`) |

### Unique Constraint

`UNIQUE(tenant_id, org_number) WHERE org_number IS NOT NULL` — partial unique index prevents duplicate org numbers per tenant while allowing nulls.

### FK Validation Pattern

`default_bas_category_code` references `bas_categories.code` (a **global** reference table with no RLS). Validation is two-step:

1. Check `bas_categories` table: does the code exist globally?
2. Check `tenant_bas_preferences` table: has the tenant activated this category?

This prevents partners from referencing BAS categories the tenant hasn't explicitly enabled. See [[cross-table-rls]] for the underlying RLS behavior with cross-table FKs.

## Soft-Delete Pattern

Domain entities use **boolean soft-delete** (`is_active` column):

- **Deactivate**: sets `is_active = false`, audit action = `"deactivate"`
- **Reactivate**: sets `is_active = true`, audit action = `"reactivate"`
- **No hard delete** — partners are retained for historical references
- **UI**: ConfirmDialog before deactivation, simple button for reactivation
- **List filtering**: "Show inactive" checkbox (default: on)
- **Audit**: `deactivate`/`reactivate` actions extend the standard `create`/`update`/`delete` set

### Why boolean, not `deleted_at`?

- Simpler queries (`WHERE is_active = true` vs `WHERE deleted_at IS NULL`)
- No temporal ambiguity (reactivation resets nothing)
- Audit log captures full lifecycle with timestamps

## Service Pattern

Services live in `src/server/services/<entity>.ts` and follow the hexagonal pattern:

```typescript
export async function createPartner(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  data: CreatePartnerInput,
): Promise<ServiceResult<{ id: string }>>
```

Key conventions:
- **Never import** from `next/*` or `src/components/*`
- **Never throw** — return `{ error: AppError }` or `{ data: T }`
- **Zod schemas** define input types; use `z.input<typeof schema>` (not `z.infer`) when schema has `.default()` values
- **Audit logging** via the `AuditLogger` callback, not direct DB writes
- **FK validation** in service layer, not DB constraints alone

## Server Action Pattern

Actions live in `src/server/actions/<entity>.ts`:

- Use `ownerAction` middleware for owner-only CRUD
- Thin wrappers — delegate all logic to services
- Return `{ error: AppError }` inside `data`, never throw
- 7 actions per entity: `get[List]`, `get[One]`, `create`, `update`, `deactivate`, `reactivate`, `search`

## Page Pattern

### List Page (`/(app)/partners/page.tsx`)

Server component that:
1. Checks auth + owner role (redirect non-owners)
2. Fetches data via `withTenantTransaction`
3. Passes serialized data to client component

### Detail Page (`/(app)/partners/[id]/page.tsx`)

Server component that:
1. Fetches single entity via `withTenantTransaction`
2. Returns `notFound()` if entity missing
3. Serializes dates (`toISOString()`) before passing to client

### Error/Not-Found Pages

- `error.tsx` — error boundary with retry button
- `not-found.tsx` — 404 with back-to-list link

## UI Component Pattern

### List Component (`partner-list.tsx`)

Client component with:
- TanStack Table (headless) + shadcn Table (rendering)
- Search filter (name + org number)
- Active/inactive toggle
- Inline create form (name + types)
- Deactivate/reactivate with ConfirmDialog
- Type badges with color coding

### Form Component (`partner-form.tsx`)

Client component with:
- Auto-save on blur for text fields
- onChange auto-save for select fields (currency, language, BAS category)
- Dedicated Save button for complex fields (address, external identifiers)
- `extractError()` helper for action result error handling

## Test Fixtures

`createTestPartner()` in `src/server/db/test-fixtures.ts` — RLS-aware SQL insert for test setup. Partners included in `cleanupTestData()` truncation.

## Related Documentation

- [[cross-table-rls]] — FK validation under RLS
- [[server-actions]] — Middleware chain and RBAC
- [[audit-trail]] — Audit logging pattern
- [[config-page-test-template]] — Test structure (config entities; domain entities extend this)
