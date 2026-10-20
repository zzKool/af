# Contract Pattern

Extends [[partner-crud-pattern]] with three new patterns introduced in Story 4.2. See partner-crud-pattern for base CRUD, soft-delete, FK validation, auto-save, and entity page patterns — not repeated here.

## 1. Child Entity Pattern

Contracts are the first **child entity** — they belong to a parent partner and do not have their own route. Key differences from top-level entities like partners:

### Data Model

- `partner_id` FK → `partners.id` (required, must be client-type partner)
- `assigned_employee_id` FK → `partners.id` (optional, must be employee-type partner)
- Two FKs to the same table require **named Prisma relations**:

```prisma
// In Contract model:
partner   Partner @relation("PartnerContracts", fields: [partnerId], references: [id])
employee  Partner? @relation("EmployeeContracts", fields: [assignedEmployeeId], references: [id])

// In Partner model (both sides required):
contracts         Contract[] @relation("PartnerContracts")
employeeContracts Contract[] @relation("EmployeeContracts")
```

### Service Layer

- `getContracts(tx, partnerId, options?)` — scoped to a single parent partner
- `createContract` validates parent partner is active + has `client` type
- `updateContract` does NOT re-validate parent (allows editing contracts on deactivated partners)
- Partner type-removal guard in `updatePartner`: cannot remove `client` or `employee` type while active contracts reference that partner in the corresponding role

### UI

- No standalone `/contracts` route — contracts render **inside** the partner detail page
- `<ContractList>` component rendered below `<PartnerForm>` with a `<Separator>`, only when `partner.types.includes("client")`
- Data fetched in a **single `withTenantTransaction`** using `Promise.all`:

```ts
const { partner, contracts, vatRegs, employees, basPrefs } =
  await withTenantTransaction(prisma, tenantId, async (tx) => {
    const [partner, basPrefs, contracts, vat, employees] = await Promise.all([
      partnerService.getPartner(tx, id),
      basService.getTenantBasPreferences(tx, caller),
      contractService.getContracts(tx, id, { includeInactive: true }),
      vatService.getVatRegistrations(tx, caller),
      partnerService.getPartners(tx, { types: ["employee"] }),
    ]);
    return { partner, basPrefs, contracts, vat, employees };
  });
```

- Inline create form (name + start date only, currency pre-populated from parent)
- Accordion expand for editing (one row at a time)
- TanStack Table for listing with "Show inactive" toggle

## 2. Decimal Money Field Pipeline

> **Superseded (2026-10-20, D24):** `contracts.billing_rate` was dropped — the rate is a dated history in `contract_rates` and the contract's current rate is derived; see [[contracts]]. The pipeline below still describes how a Decimal money field crosses the layers (now `contract_rates.rate`).

`billing_rate` was the first Decimal(15,2) money field. The pipeline:

```
Form (string) → Zod (string) → Service (Prisma.Decimal) → DB (DECIMAL(15,2)) → Serialized (string) → Component (display)
```

- **Zod schema**: `billingRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()` — validates format as string
- **Service**: `new Prisma.Decimal(data.billingRate)` — converts to Prisma Decimal for DB write
- **Serialization** (in page.tsx): `c.billingRate ? c.billingRate.toString() : null` — Decimal back to string for client component
- **Display**: `Number(rate).toFixed(2)` — format for display only
- **Import**: `import { Prisma } from "@/generated/prisma/browser"` (not `@/generated/prisma`)

## 3. Dual Self-Referential FK

Two foreign keys from `contracts` to `partners`:
- `partner_id` → the client partner who owns the contract
- `assigned_employee_id` → the employee partner assigned to work on it

Both point to the same `partners` table but with different validation rules:
- `partner_id`: partner must have `client` in `types` array, must be active
- `assigned_employee_id`: partner must have `employee` in `types` array (active check not enforced — employees may be deactivated after assignment)

The partner service `getPartners` accepts `types?: string[]` option using Prisma's `hasSome` filter to fetch only employee-type partners for the UI selector.
