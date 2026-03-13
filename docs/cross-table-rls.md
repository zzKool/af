# Cross-Table RLS Behavior with Foreign Keys

**Date:** 2026-03-13
**Context:** Story 4.0 Epic 4 Prep Sprint — RLS spike for inter-entity FK relationships
**Relevant for:** Epic 4 stories 4.1–4.3 (Partner, Contract entities with cross-table FKs)

## Summary

PostgreSQL RLS policies are enforced per-table on SELECT/INSERT/UPDATE/DELETE operations. When Prisma generates JOINs (via `include` or relation filters), each table's RLS policy is evaluated independently. **RLS isolation holds correctly across JOINs.**

However, **FK constraint validation bypasses RLS** — this is by PostgreSQL design. A tenant can reference another tenant's record via FK if the constraint is satisfied. Service-level validation is required.

## Findings

### Scenario 1: Prisma `include` (JOIN)

**Result: RLS holds.**

```typescript
// Tenant A sees only own records + related records
const accounts = await tx.bankAccount.findMany({
  include: { bankFormat: true }, // JOIN to app-level table
});
// Tenant B sees nothing from tenant A
```

Prisma's `include` generates LEFT JOINs. Each table's RLS policy filters independently. Parent rows are filtered by tenant, and child rows from app-level tables (no RLS) are visible to all.

### Scenario 2: Prisma relation filter

**Result: RLS holds.**

```typescript
// Filtering through FK relation respects RLS on both tables
const filtered = await tx.bankAccount.findMany({
  where: { bankFormat: { bankName: { contains: "" } } },
});
```

Prisma generates subqueries or JOINs with WHERE clauses. RLS on the outer table limits visibility to own-tenant rows.

### Scenario 3: Raw SQL JOIN

**Result: RLS holds.**

```sql
SELECT v.country, b.account_number
FROM vat_registrations v
CROSS JOIN bank_accounts b
```

Both tables independently filter by `app.tenant_id`. Cross-tenant rows are invisible.

### Scenario 4: FK constraint cross-tenant reference

**Result: FK constraints BYPASS RLS. Service-level validation REQUIRED.**

PostgreSQL FK constraints are checked by the table owner role, which bypasses RLS. This means:

- Tenant A **can** set a FK column to reference Tenant B's record
- The FK constraint check sees all rows (ignores RLS)
- The INSERT/UPDATE succeeds if the target record exists in any tenant

This is documented PostgreSQL behavior: FK constraint checks and unique constraint checks always operate as the table owner, not the current role.

## Implications for Epic 4

### Partner → VatRegistration FK (`partners.default_vat_registration_id`)

- **Reads are safe:** `include: { defaultVatRegistration: true }` respects RLS
- **Writes need validation:** Service must verify the referenced `vat_registration_id` belongs to the same tenant before saving

### Contract → Partner FK (`contracts.partner_id`)

- Same pattern: reads safe, writes need validation

### Contract → VatRegistration FK (`contracts.vat_registration_id`)

- Same pattern: reads safe, writes need validation

### Recommended Service-Level Validation Pattern

```typescript
// In partner service (or any service with cross-table FK)
async function createPartner(tx, callerIdentity, data) {
  if (data.defaultVatRegistrationId) {
    // Verify FK target belongs to same tenant (within same transaction)
    const vatReg = await tx.vatRegistration.findUnique({
      where: { id: data.defaultVatRegistrationId },
    });
    if (!vatReg) {
      return { error: { message: "VAT registration not found" } };
    }
    // RLS ensures vatReg.tenantId matches — if found, it's same-tenant
  }
  // Proceed with create
}
```

Because the query runs within `withTenantTransaction`, RLS automatically filters. If `findUnique` returns null, the FK target either doesn't exist or belongs to another tenant — both are invalid.

## Test Verification

Spike tests are in `src/server/test-utils/cross-table-rls-spike.test.ts`. Run with:

```bash
npx vitest run src/server/test-utils/cross-table-rls-spike.test.ts
```
