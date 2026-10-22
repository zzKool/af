# VAT Registrations

Multi-country VAT registration management for tenant companies.

## Overview

VAT registrations store a tenant's VAT numbers and applicable rate schedules across multiple countries. Each registration represents a single country-specific VAT identity (e.g., Swedish moms, Swiss MWST).

Unlike [[bas-categories]] (shared reference data), VAT registrations are purely **tenant-created data** — no seeding, no reference table, no quick-start button.

## Data Model

### vat_registrations Table

Follows the mandatory tenant model template (`id`, `tenantId`, `createdAt`, `updatedAt`, `createdBy`, `source`):

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | FK to tenants, RLS-scoped |
| `country` | VARCHAR(2) | ISO 3166-1 alpha-2 code ("SE", "CH", "DE") |
| `vat_number` | VARCHAR(50) | Full VAT number ("SE556677889001") |
| `rate_schedule` | JSONB | Nullable (SQL `NULL` = no rates, on create and when cleared); `{ rates: [25, 12, 6] }` |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |
| `created_by` | UUID | User who created the registration |
| `source` | VARCHAR(20) | Origin: "web", "mcp", etc. |

### Unique Constraint

`UNIQUE(tenant_id, country, vat_number)` — allows multiple registrations per country (different VAT numbers for different business activities), while preventing true duplicates.

### Rate Schedule JSONB Structure

```json
{ "rates": [25, 12, 6] }
```

- Rates are percentage numbers (not Decimals) — convenience data, not source of truth
- Journal entries (Epic 6+) MUST snapshot the applied rate per entry, never reference rate_schedule dynamically
- Max 10 rates per registration (no country exceeds 6 tiers)
- Validated by Zod schema: `z.object({ rates: z.array(z.number().min(0).max(100)).min(1).max(10) }).strict()` — on write, and **on read**: `getVatRegistrations` returns `VatRegistrationDto` with `rateSchedule: RateSchedule | null` through `parseRateSchedule`; a stored value that does not read as a schedule (JSON `null`, a bare array, a rate as text, > 100, an extra key) reads as `null`, never cast ([[lessons]] 19, 29)
- Clearing the rates writes SQL `NULL` (`Prisma.DbNull`). Rows cleared before F64 may hold JSON `'null'` (Prisma 7 stores a plain `null` that way — V6); they read as `null` too, and a data fix rides with the next schema PR

**Future migration path:** When Epic 10 (Invoicing) needs labeled rates for line-item selection, the shape may evolve from `[25, 12, 6]` to `[{value: 25, label: "Standard"}, ...]`. This is a non-breaking JSONB change at the service layer.

## Design Decisions

### Country Immutability

Country is immutable after creation. Users delete and re-add rather than changing a registration's country. This eliminates unique-constraint collision bugs on update and simplifies the service/action/UI.

### No Seeding

VAT numbers are business-specific and cannot be pre-populated. The table starts empty for every new tenant.

### Delete Safety

A registration that an invoice (any type or status, drafts included) or a Swiss VAT declaration carries cannot be deleted — the **service** refuses with `BUSINESS_RULE_VIOLATION`, `details: { invoices, declarations }` (F64, [[lessons]] 19). Settings never reads those tables: each owner counts its own rows through a usage hook, wired by the composition root like `contracts.setRateUsage` (D24):

```
src/instrumentation.ts
  settings.setVatRegistrationUsage("invoices",     invoices.vatRegistrationUsageFromInvoices)   ─┐
  settings.setVatRegistrationUsage("declarations", exports.listDeclarations → filter by id)     ─┤
                                                                                                 ▼
  deleteVatRegistration: sum > 0 ? refuse : delete + audit
```

Unwired (a script, a test that does not wire) counts 0 — the same as contracts. Not counted yet: expenses and supplier invoices, which also carry `vat_registration_id` (lessons 19 *Left*). Contracts reference it by a real FK (`ON DELETE SET NULL`).

## Downstream Consumers

VAT registrations will be consumed by:

- **Epic 4 (Partners & Contracts)**: Contract VAT rules reference tenant's VAT registrations
- **Epic 10 (Invoicing)**: Invoice generation uses VAT rates from registrations
- **Declaration exports**: Momsdeklaration filtering by VAT registration

The `getVatRegistrations` service method will be reused by these future stories.

## Auto-Save UX Pattern

The VAT registrations page follows the same auto-save pattern as [[bas-categories]]:

- Text fields (`vatNumber`): save onBlur via `useAction()` + `executeAsync`
- Rate schedule: save onBlur (parse comma-separated → number array → validate → save)
- Toast only on error; success is silent
- Optimistic updates with error rollback
- Country displayed as read-only text (not editable)
- Rate pills displayed for visual confirmation

## Related

- [[prisma-rls-setup]] — RLS tenant isolation pattern
- [[audit-trail]] — Audit logging for all CRUD operations
- [[server-actions]] — ownerAction RBAC enforcement for all VAT operations
- [[bas-categories]] — Sister config page with similar patterns
- [[config-page-test-template]] — Test structure for config CRUD pages
