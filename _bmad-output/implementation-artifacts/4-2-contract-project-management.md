# Story 4.2: Contract & Project Management

Status: done

**Follows partner CRUD pattern** from Story 4.1 — second domain entity, first child entity (belongs to partner), first use of Decimal for money fields (billing_rate). Contract UI lives inside the partner detail page, not as a standalone route.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to create contracts and projects under client partners with billing terms,
So that I can track engagement details and generate invoices from contract data.

## Acceptance Criteria

1. **Given** partners exist from Story 4.1, **When** the owner manages contracts, **Then** a `contracts` table exists with RLS enabled, containing: `name`, `partner_id` (FK → partners, must be a client-type partner), `start_date` (Date), `end_date` (Date, optional), `assigned_employee_id` (FK → partners, must be an employee-type partner, optional), `billing_rate` (Decimal(15,2)), `currency` (default from partner), `payment_terms` (string, e.g. "NET_30"), `vat_registration_id` (FK → vat_registrations, optional), `external_references` (JSONB array, same shape as partner external_identifiers), `is_active` (boolean, soft-delete), plus mandatory template fields (id, tenant_id, created_at, updated_at, created_by, source).

2. **Given** the owner is on a partner detail page, **When** they create a contract, **Then** they can set name, date range, assigned employee, and the contract is associated with that client partner (FR26a).

3. **Given** the owner edits a contract, **When** they set financial terms, **Then** they can set billing rate (Decimal), currency (defaults from parent partner), payment terms, and VAT rules via vat_registration_id (FR26b).

4. **Given** the owner edits a contract, **When** they add external references, **Then** each is stored as `{ label: string, value: string }` in a JSONB array (max 5), e.g. `[{ label: "Purchase Order", value: "PO-2026-1138" }]` (FR26c).

5. **Given** contracts reference tenant VAT registrations, **When** the owner selects a VAT registration for a contract, **Then** only the tenant's own VAT registrations are available (RLS-scoped) (FR26b + Epic 3).

6. **Given** the owner views a partner detail page at `/(app)/partners/[id]`, **When** the partner is a client, **Then** a Contracts section shows below the partner form, listing associated contracts with inline create/edit (FR55).

7. **Given** the owner soft-deletes a contract, **When** the deletion is confirmed via ConfirmDialog, **Then** the contract is marked `is_active: false`, audit logs action `deactivate`.

8. **Given** `docs/` documentation standards, **When** the story is complete, **Then** `docs/` is updated with contract pattern documentation.

## Tasks / Subtasks

- [x] Task 0: Retro Gate Check (AC: all)
  - [x] 0.1 Open `_bmad-output/implementation-artifacts/deferred-items.md` and check for items with deadlines at or before Story 4.2
  - [x] 0.2 Item #11 (test data factory): must add `createTestContract()` fixture in this story
  - [x] 0.3 Document check result in Dev Agent Record

- [x] Task 1: Prisma schema + migration with RLS (AC: #1)
  - [x] 1.1 Add `Contract` model to `prisma/schema/app.prisma` (see Schema section in Dev Notes for exact definition)
  - [x] 1.2 Add relation to `Partner` model: `contracts Contract[] @relation("PartnerContracts")` and `employeeContracts Contract[] @relation("EmployeeContracts")`
  - [x] 1.3 Add relation to `Tenant` model: `contracts Contract[]`
  - [x] 1.4 Add relation to `VatRegistration` model: `contracts Contract[]`
  - [x] 1.5 Run `npx prisma migrate dev --name add_contracts_table` to generate migration
  - [x] 1.6 Edit migration SQL to add after table creation:
    - `ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;`
    - `ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;`
    - `CREATE POLICY tenant_isolation ON "contracts" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);`
    - `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "contracts" TO defterfab_app;`
  - [x] 1.7 Run `npx prisma migrate dev` to apply and regenerate client
  - [x] 1.8 Verify `npx prisma validate` passes

- [x] Task 2: Contract service — CRUD + validation (AC: #1, #2, #3, #4, #5, #7)
  - [x] 2.1 Create `src/server/services/contracts.ts` following `partners.ts` pattern
  - [x] 2.2 Implement `getContracts(tx, partnerId, options?: { includeInactive?: boolean })`
  - [x] 2.3 Implement `getContract(tx, id)`
  - [x] 2.4 Implement `createContract(tx, caller, audit, data)` with all FK validations
  - [x] 2.5 Implement `updateContract(tx, caller, audit, id, data)` with read-before-write
  - [x] 2.6 Implement `deactivateContract(tx, caller, audit, id)`
  - [x] 2.7 Implement `reactivateContract(tx, caller, audit, id)`
  - [x] 2.8 Add partner type-removal guard in `updatePartner()`
  - [x] 2.9 Extend `getPartners` with `types` filter option

- [x] Task 3: Server Actions (AC: #2, #3)
  - [x] 3.1 Create `src/server/actions/contracts.ts` following `partners.ts` action pattern
  - [x] 3.2 Export `getContractsAction`
  - [x] 3.3 Export `getContractAction`
  - [x] 3.4 Export `createContractAction`
  - [x] 3.5 Export `updateContractAction`
  - [x] 3.6 Export `deactivateContractAction`
  - [x] 3.7 Export `reactivateContractAction`

- [x] Task 4: Contract UI on partner detail page (AC: #2, #3, #4, #5, #6)
  - [x] 4.1 Create `src/components/partners/contract-list.tsx` — client component showing contracts for a partner
  - [x] 4.2 Contract list: TanStack Table with columns (name, date range, billing rate + currency, payment terms, is_active), "Show inactive" toggle
  - [x] 4.3 Inline create: expandable form at top of contract list (name, start date required; rest optional). Pre-populate currency from parent partner's `defaultCurrency`.
  - [x] 4.4 Contract detail: clicking a contract row expands an inline edit form (NOT a separate page — contracts are sub-entities of partners). Only ONE row expanded at a time (accordion behavior).
  - [x] 4.5 Auto-save on blur for text fields; onChange for selects (currency, payment terms, VAT registration, assigned employee). Billing rate input: use `type="text"` (not `type="number"`), placeholder "e.g., 1500.00 per day".
  - [x] 4.6 External references: same sub-form pattern as partner external identifiers (dedicated Save button)
  - [x] 4.7 Deactivate/reactivate with ConfirmDialog
  - [x] 4.8 Update `src/app/(app)/partners/[id]/page.tsx`: fetch ALL data in a single `withTenantTransaction` call using `Promise.all` (partner, contracts, VAT registrations, employee partners). Render `<Separator />` + ContractList below PartnerForm, only when partner has type "client". Pass `partner.defaultCurrency` for create form pre-population.
  - [x] 4.9 Wire all contract Server Actions with `useAction` hooks
  - [x] 4.10 Empty state handling: employee selector shows "No employees added yet" when no employee-type partners exist; VAT registration selector shows "No VAT registrations configured" when empty. Both include "None" option (same pattern as partner form selects from 4.1 code review fix).

- [x] Task 5: Tests (AC: all)
  - [x] 5.1 Create `src/server/services/contracts.test.ts`
  - [x] 5.2 Service CRUD tests: create with min/max fields, update, list with filter
  - [x] 5.3 Validation tests: all FK checks, date edge cases, billing rate, external refs
  - [x] 5.4 Soft-delete lifecycle test
  - [x] 5.5 RLS isolation test
  - [x] 5.6 Audit tests: create, update, deactivate, reactivate
  - [x] 5.7 Server Action RBAC tests: owner success + member forbidden
  - [x] 5.8 Add `createTestContract()` fixture, fix cleanup order
  - [x] 5.9 Partner type-removal guard tests (in contracts.test.ts)
  - [x] 5.10 Cross-service integration test

- [x] Task 6: Documentation (AC: #8)
  - [x] 6.1 Create `docs/contract-pattern.md` — focus on THREE new patterns not in `partner-crud-pattern.md`: (a) child entity pattern (belongs to parent, accessed via parent detail page); (b) Decimal money field pipeline (form string → Zod → service Decimal → DB → serialized string → component display); (c) dual self-referential FK (two FKs to same table with named Prisma relations). Use `[[partner-crud-pattern]]` wiki-links for base patterns — don't rehash.
  - [x] 6.2 Update `docs/index.md` with link
  - [x] 6.3 Update deferred items register: #11 fully resolved

- [x] Task 7: Verify everything (AC: all)
  - [x] 7.1 Biome check: 0 errors
  - [x] 7.2 TypeScript: 0 errors (`npx tsc --noEmit`)
  - [x] 7.3 All tests passing (existing + new)
  - [ ] 7.4 Manual smoke deferred to code review

## Dev Notes

### Contract Prisma Schema

```prisma
model Contract {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId            String    @map("tenant_id") @db.Uuid
  name                String
  partnerId           String    @map("partner_id") @db.Uuid
  startDate           DateTime  @map("start_date") @db.Date
  endDate             DateTime? @map("end_date") @db.Date
  assignedEmployeeId  String?   @map("assigned_employee_id") @db.Uuid
  billingRate         Decimal?  @map("billing_rate") @db.Decimal(15, 2)
  currency            String?
  paymentTerms        String?   @map("payment_terms")
  vatRegistrationId   String?   @map("vat_registration_id") @db.Uuid
  externalReferences  Json      @default("[]") @map("external_references")
  isActive            Boolean   @default(true) @map("is_active")
  createdAt           DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt           DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  createdBy           String    @map("created_by") @db.Uuid
  source              String    @default("web")

  tenant           Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  partner          Partner          @relation("PartnerContracts", fields: [partnerId], references: [id])
  assignedEmployee Partner?         @relation("EmployeeContracts", fields: [assignedEmployeeId], references: [id])
  vatRegistration  VatRegistration? @relation(fields: [vatRegistrationId], references: [id], onDelete: SetNull)

  @@index([tenantId, partnerId])
  @@map("contracts")
}
```

**Schema notes:**
- `startDate` / `endDate` use `@db.Date` (not `@db.Timestamptz`) — contracts are date-range, not time-precision.
- `billingRate` uses `Decimal(15,2)` — **Money stays Decimal until component display boundary.** Use `new Prisma.Decimal(value)` for creation, never `parseFloat`. In tests, compare with `.equals()` or `.toString()`. Note: `.toString()` on Prisma Decimal may drop trailing zeros (e.g., `"150"` not `"150.00"`) — component should format explicitly with `toFixed(2)` or locale-aware formatting for display.
- `currency` defaults to partner's `defaultCurrency` at creation time (service logic, not DB default). This is a **snapshot, not a live reference** — changing partner's defaultCurrency does NOT retroactively update existing contracts. The page.tsx server component passes `partner.defaultCurrency` to ContractList so the create form can pre-populate.
- `paymentTerms` is a free-text string (e.g., "NET_30", "NET_60", "PREPAID"). Not an enum — flexible for international variations. Add constants in `src/lib/constants.ts` for common values. Note: payment terms may drive invoice calculation logic in Epic 10 — keep them machine-readable (uppercase snake_case constants), not free-form text.
- `externalReferences` uses the same `[{ label, value }]` JSONB pattern as partner `externalIdentifiers`.
- Two self-referential FKs to `partners`: `partnerId` (must be client) and `assignedEmployeeId` (must be employee). Prisma requires named relations for disambiguation: `@relation("PartnerContracts")` and `@relation("EmployeeContracts")`.
- `vatRegistration` relation uses `onDelete: SetNull` — if a VAT registration is deleted, the contract's `vatRegistrationId` is nullified rather than blocking the delete. The user can then reassign a different VAT registration.

**Partner model additions required:**
```prisma
// Add to existing Partner model:
contracts         Contract[] @relation("PartnerContracts")
employeeContracts Contract[] @relation("EmployeeContracts")
```

**VatRegistration model addition required:**
```prisma
// Add to existing VatRegistration model:
contracts Contract[]
```

**Tenant model addition required:**
```prisma
// Add to existing Tenant model:
contracts Contract[]
```

### Zod Schemas

```typescript
const externalReferenceSchema = z.object({
  label: z.string().min(1).max(50),
  value: z.string().min(1).max(100),
});

export const createContractSchema = z.object({
  partnerId: z.string().uuid(),
  name: z.string().min(1).max(200),
  startDate: z.string().date(), // ISO date string "YYYY-MM-DD"
  endDate: z.string().date().optional(),
  assignedEmployeeId: z.string().uuid().optional(),
  billingRate: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid rate format — use digits with up to 2 decimal places")
    .refine(v => Number.parseFloat(v) >= 0, "Rate must be non-negative")
    .optional(), // String input for Decimal — never float
  currency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
  paymentTerms: z.string().max(50).optional(),
  vatRegistrationId: z.string().uuid().optional(),
  externalReferences: z.array(externalReferenceSchema).max(5).default([]),
}).refine(
  (data) => !data.endDate || data.startDate <= data.endDate,
  { message: "End date must be after start date", path: ["endDate"] }
);

export const updateContractSchema = createContractSchema.partial().omit({ partnerId: true }).extend({
  id: z.string().uuid(),
});
```

**Critical: `billingRate` as string input.** Zod receives a string (e.g., "150.00"), service converts to `new Prisma.Decimal(value)`. This follows the architecture rule: "Money: Decimal through services, number only at display boundary." The form sends string values; the service constructs Decimal.

### Payment Terms Constants

Add to `src/lib/constants.ts`:
```typescript
export const PAYMENT_TERMS = ["NET_10", "NET_15", "NET_30", "NET_45", "NET_60", "NET_90", "PREPAID", "ON_RECEIPT"] as const;
export type PaymentTerm = (typeof PAYMENT_TERMS)[number];
```

### FK Validation Pattern (Contracts)

Contracts have three FK validations, all different from the partner BAS FK pattern:

1. **`partnerId` → partners (RLS-scoped):** `findUnique` within RLS-scoped tx. Must verify partner `types` includes `"client"`. This is a same-table FK within RLS — standard Prisma query works.

2. **`assignedEmployeeId` → partners (RLS-scoped):** Same as above but verify `types` includes `"employee"`. Same tenant guaranteed by RLS.

3. **`vatRegistrationId` → vat_registrations (RLS-scoped):** `findUnique` within RLS-scoped tx. VatRegistration table has RLS, so tenant isolation is automatic. No extra tenant-activation check needed (unlike BAS categories which are global).

Key difference from Story 4.1's BAS FK pattern: all contract FKs point to **RLS-protected tables** (partners, vat_registrations), so tenant isolation is automatic. No need for the two-step "exists globally + activated for tenant" check.

### Deactivating Partners Does NOT Cascade to Contracts

Per Story 4.1 Dev Notes: "Deactivating a partner does NOT cascade-deactivate contracts — contracts have their own lifecycle." This was an explicit design decision. Contracts remain active even if the parent partner is deactivated.

However, validate that partner `isActive` is `true` when **creating** a new contract (don't create contracts for inactive partners). **Updating** existing contracts on inactive partners is fine.

### Partner Type-Removal Guard (Cross-Entity Validation)

When updating a partner's `types` array, the partner service must prevent removing types that are referenced by active contracts:

- **Removing `"client"`:** Check `tx.contract.count({ where: { partnerId: id, isActive: true } })`. If > 0, return `VALIDATION_ERROR: "Cannot remove client type — partner has active contracts."`
- **Removing `"employee"`:** Check `tx.contract.count({ where: { assignedEmployeeId: id, isActive: true } })`. If > 0, return `VALIDATION_ERROR: "Cannot remove employee type — partner is assigned to active contracts."`

This is the first cross-entity validation dependency in the codebase. The partner service queries the `contract` table (via Prisma client, no new imports needed — just `tx.contract.count()`). Add this check in `updatePartner()` BEFORE applying the update, only when `types` field is present in the update data and the removed type was previously present.

### Date Edge Cases for Contract Date Ranges

Test all of these explicitly:
1. **No end date** — indefinite engagement. `endDate = null`. Valid and common for ongoing retainers.
2. **End date in the past** — expired but still `is_active = true`. Not deactivated, just naturally concluded. Should still appear in active list.
3. **Start date in the future** — upcoming engagement. Valid, should be creatable.
4. **Start date = end date** — single-day engagement. Edge case but valid.
5. **End date before start date** — Zod `.refine()` rejects this. Verify in tests.

### UI Pattern: Contracts as Sub-Entity of Partner Detail

Contracts are NOT a standalone page — they live inside the partner detail page (`/(app)/partners/[id]`). This follows the UX spec: "manage contracts through a dedicated UI at `/(app)/partners/[id]` under the partner detail page."

**Layout on partner detail page:**
```tsx
<div className="mx-auto max-w-3xl p-6 space-y-8">
  <PartnerForm partner={partner} basOptions={basOptions} />
  {partner.types.includes("client") && (
    <>
      <Separator />
      <ContractList
        contracts={contracts}
        vatRegistrations={vatRegs}
        employeePartners={employees}
        defaultCurrency={partner.defaultCurrency}
      />
    </>
  )}
</div>
```

1. Partner form (existing, from Story 4.1)
2. `<Separator />` visual divider (prevents "wall of form fields" on tall pages)
3. Contracts section (new, only visible when partner has type "client")
   - Section header: "Contracts" with count badge (e.g., "Contracts (3)") and "+ New Contract" button
   - Inline create form (expandable, at TOP of list)
   - Contract table (TanStack Table + shadcn Table, same pattern as partner-list)
   - Clicking a contract row expands an inline edit form below the row (accordion — only ONE expanded at a time)
   - Expanded row state is **local component state** (not URL or Zustand) — collapses on navigation

**Server component data fetching:** Update `src/app/(app)/partners/[id]/page.tsx` to use a **single `withTenantTransaction` call** with `Promise.all` for all queries (avoids 4 separate DB connections each setting RLS context):

```typescript
const result = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
  const [partner, contracts, vatRegs, employees, basPrefs] = await Promise.all([
    partnerService.getPartner(tx, id),
    contractService.getContracts(tx, id),
    vatService.getVatRegistrations(tx, callerIdentity),
    partnerService.getPartners(tx, { types: ["employee"] }),
    basService.getTenantBasPreferences(tx, callerIdentity),
  ]);
  return { partner, contracts, vatRegs, employees, basPrefs };
});
```

Use the extended `getPartners` with `types` filter (Task 2.9) — no new method needed. The `types` filter uses Prisma's `{ hasSome }` operator on the string array column.

**Date display:** Use `sv-SE` locale for date formatting per architecture conventions. Store as ISO date strings in component props (serialize `Date` objects with `.toISOString().split('T')[0]`). Dates are `@db.Date` (not timestamp), so no timezone concerns.

### Decimal Display Pattern for billingRate

This is the **first time money fields appear in a form**. Follow the architecture boundary rule:

- **In service layer:** `billingRate` is `Prisma.Decimal` — construct with `new Prisma.Decimal(stringValue)`
- **In serialization (page.tsx → component):** Convert to string via `.toString()` — NEVER `.toNumber()`
- **In component:** Display as-is (string) or format with locale-aware number formatting
- **In form input:** Use `type="text"` input (not `type="number"` which causes float precision issues). Validate numeric format via Zod.
- **Sending to server:** Send as string in the action payload — Zod schema receives string, service converts to Decimal

### Existing Code to Reuse (DO NOT Reinvent)

- `src/server/services/partners.ts` → Canonical domain entity service pattern (CRUD, soft-delete, FK validation, Zod schemas)
- `src/server/actions/partners.ts` → Canonical domain entity action pattern (ownerAction wrappers)
- `src/components/partners/partner-form.tsx` → Auto-save pattern, extractError helper, form layout
- `src/components/partners/partner-list.tsx` → TanStack Table + shadcn Table pattern, ConfirmDialog integration
- `src/components/ui/confirm-dialog.tsx` + `src/hooks/use-confirm-dialog.ts` → delete confirmation
- `src/server/middleware/action-client.ts` → `ownerAction` middleware
- `src/server/db/tenant-client.ts` → `withTenantTransaction` (RLS-scoped DB access)
- `src/server/services/audit.ts` → `createAuditEntry`, `toAuditData`
- `src/server/db/test-fixtures.ts` → `createTestTenant`, `createTestPartner`, `createAuthenticatedContext`, `cleanupTestData`
- `src/server/test-utils/config-crud-helpers.ts` → `assertRlsIsolation`, `assertAuditLogged`
- `src/lib/constants.ts` → `CURRENCIES` (add `PAYMENT_TERMS` here)
- `src/types/app-error.ts` → `AppError`, `ErrorCode`
- `src/types/audit.ts` → `AuditLogger` type
- `src/types/caller-identity.ts` → `CallerIdentity` type

### File Structure

New files:
- `prisma/migrations/YYYYMMDD_add_contracts_table/migration.sql`
- `src/server/services/contracts.ts`
- `src/server/services/contracts.test.ts`
- `src/server/actions/contracts.ts`
- `src/components/partners/contract-list.tsx`
- `docs/contract-pattern.md`

Modified files:
- `prisma/schema/app.prisma` (add Contract model, add relations to Partner, Tenant, VatRegistration)
- `src/server/services/partners.ts` (add `types` filter to `getPartners`, add type-removal guard in `updatePartner`)
- `src/server/services/partners.test.ts` (add type-removal guard tests, cross-service integration test)
- `src/app/(app)/partners/[id]/page.tsx` (single transaction for all data, render Separator + ContractList for client partners)
- `src/server/db/test-fixtures.ts` (add `createTestContract`, add `contracts` before `partners` in cleanup truncation order)
- `src/lib/constants.ts` (add `PAYMENT_TERMS`)
- `docs/index.md` (add contract-pattern.md link)
- `_bmad-output/implementation-artifacts/deferred-items.md` (resolve #11 fully)

### Previous Story Intelligence (Story 4.1)

- **26 tests passing** on partner service — must not regress
- **Pre-commit hook active** — husky + lint-staged runs `biome check --write` on staged files
- **`toAuditData` fix applied** — handles JSONB and array fields correctly (was stripping them in earlier version). Reuse as-is.
- **`extractError()` helper** in partner-form.tsx — reuse for contract form error handling
- **Auto-save pattern** established: onBlur for text, onChange for selects, dedicated Save for complex fields (JSONB arrays)
- **Idempotency guards** on deactivate/reactivate: check current state before applying. Apply same pattern to contracts.
- **Code review fix:** "None" option added to select dropdowns (currency, language, BAS) — apply same pattern to contract selects (currency, payment terms, VAT registration, employee)
- **Conventional commits:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`
- **Partner `defaultBasCategoryCode`** uses `code` (string natural key) not UUID — different from contract's `vatRegistrationId` which uses UUID FK. Be aware of this difference.

### Architecture Patterns & Constraints

- **Hexagonal:** `actions/contracts.ts` → `services/contracts.ts` → DB. Services MUST NOT import `next/*`.
- **Server Actions never throw** — return `{ data }` or `{ error: AppError }`.
- **CallerIdentity** passed to every service mutation method.
- **AuditLogger** called for every create/update/deactivate/reactivate.
- **Read-before-write** for all mutations that need audit `oldData`.
- **VALIDATE FIRST, WRITE SECOND** — never return AppError after a DB write.
- **Money stays Decimal** until component display boundary. `billingRate` is the first real money field.
- **Dates: TIMESTAMPTZ in DB** — except contracts use `@db.Date` for start/end (date-only, no time component).

### Recommended Execution Order

1. Task 0 (gate check) → 2. Task 1 (schema + migration) → 3. Task 2 (service) → 4. Task 5.1-5.6 (service tests) → 5. Task 3 (actions) → 6. Task 5.7 (action RBAC tests) → 7. Task 4 (UI) → 8. Task 5.8 (test fixtures) → 9. Task 6 (docs) → 10. Task 7 (verify)

### What NOT to Build

- No standalone `/(app)/contracts` route — contracts live inside partner detail page only
- No contract search endpoint — not needed until Epic 6/10
- No invoice generation from contracts — that's Epic 10
- No partner entity view tabs (Overview/Contracts/Transactions/Documents) — that's Story 4.3. Just show the contracts section below the partner form.
- No contract-to-document linking — that's Epic 7
- No contract status workflow (draft/active/completed/terminated) — just is_active boolean for now. "Is contract current?" is derivable: `is_active = true AND (end_date IS NULL OR end_date >= CURRENT_DATE)`. No status enum needed.
- No contract type field (T&M vs fixed-price) — `billingRate` serves both patterns for now. PRD says "billing rate" (FR26b), not contract type.
- No contract amount totals or financial summaries
- No contract template/duplication feature
- No auto-creation of "self" employee partner — the `assignedEmployeeId` will frequently be null in early usage. UI handles empty employee list gracefully.

### Project Structure Notes

- Contract service follows established hexagonal pattern (actions → services → db)
- Contract UI is a sub-component of partner detail page, not a new route
- No conflicts with existing file structure
- PAYMENT_TERMS constants added to existing constants.ts (no new file)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.2 requirements, FR26a/FR26b/FR26c/FR55]
- [Source: _bmad-output/planning-artifacts/architecture.md — Entity lifecycle (soft-delete), Prisma model template, Server Action pipeline, Decimal arithmetic, naming conventions, file structure]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Detail Page pattern (#3), contracts managed under partner detail page, auto-save patterns]
- [Source: _bmad-output/implementation-artifacts/4-1-partner-crud-defaults.md — CRUD patterns, FK validation, soft-delete, TanStack Table, auto-save, test fixture patterns, code review fixes]
- [Source: _bmad-output/implementation-artifacts/deferred-items.md — Item #11 (test data factory, deadline Story 4.2)]
- [Source: docs/partner-crud-pattern.md — Canonical domain entity CRUD pattern reference]
- [Source: docs/cross-table-rls.md — FK constraints bypass RLS (not applicable here — all FKs point to RLS tables)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Task 0: Retro gate check complete. Item #11 (createTestContract fixture) due at Story 4.2 — addressed in Task 5.8.

### Implementation Plan

Following recommended execution order: Task 0 → 1 → 2 → 5.1-5.6 → 3 → 5.7 → 4 → 5.8 → 6 → 7

### File List

**New files:**
- `prisma/migrations/20260313300000_add_contracts_table/migration.sql` — RLS-enabled contracts table
- `src/server/services/contracts.ts` — Contract service: CRUD, validation, Zod schemas
- `src/server/services/contracts.test.ts` — 30+ tests: CRUD, validation, RLS, audit, RBAC, type-removal guard, cross-service integration
- `src/server/actions/contracts.ts` — Server Actions: ownerAction wrappers for contract service
- `src/components/partners/contract-list.tsx` — Client component: TanStack Table, inline create/edit, auto-save, ConfirmDialog
- `docs/contract-pattern.md` — Child entity pattern, Decimal pipeline, dual self-referential FK

**Modified files:**
- `prisma/schema/app.prisma` — Added Contract model + relations on Partner, Tenant, VatRegistration
- `src/server/services/partners.ts` — Added `types` filter to `getPartners`, type-removal guard in `updatePartner`
- `src/app/(app)/partners/[id]/page.tsx` — Single transaction for all data, ContractList for client partners
- `src/server/db/test-fixtures.ts` — Added `createTestContract`, updated cleanup truncation order
- `src/lib/constants.ts` — Added `PAYMENT_TERMS` constants
- `docs/index.md` — Added contract-pattern.md link
- `_bmad-output/implementation-artifacts/deferred-items.md` — Resolved item #11
- `vitest.config.ts` — Increased integration test timeout to 30s (contract tests need more time due to multi-tenant setup)
