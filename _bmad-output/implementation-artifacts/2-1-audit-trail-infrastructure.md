# Story 2.1: Audit Trail Infrastructure

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want every action in the system recorded in an immutable audit trail with source provenance,
So that I have a complete, tamper-proof record of all changes for legal compliance and accountability.

## Scope

This story establishes the audit infrastructure and proves the pattern on one entity (`Tenant` via `updateTenantProfile`). Future stories wire audit into their respective services as they are built. FR45 (all entities) and FR46 (all data points) are partially fulfilled here and completed incrementally across subsequent stories. No backfill is required — audit trail captures mutations from deployment forward.

## Acceptance Criteria

1. An `audit_logs` table exists with fields: id, tenantId, userId, action, entityType, entityId, oldData, newData, source, createdAt
2. The audit table has RLS policies enforcing tenant isolation (both read and write — includes `WITH CHECK` on INSERT)
3. The audit table has PostgreSQL-level rules preventing UPDATE and DELETE operations
4. An `audit` context helper is added to the Server Action pipeline, providing an opt-in `audit.log()` function that services call explicitly for mutations (FR45)
5. Every audit entry records source provenance: 'web', 'mcp', 'cli', or 'system' (FR46). Seed source (`source === "seed"`) skips audit — it is not a real user action
6. Integration tests attempt UPDATE on audit_logs and assert the operation has no effect (0 rows changed, original data intact) — PostgreSQL RULE silently drops the operation, it does NOT throw
7. Integration tests attempt DELETE on audit_logs and assert the operation has no effect (0 rows changed, original data intact) — same silent RULE behavior
8. Integration tests verify that a Server Action mutation produces a corresponding audit entry with correct entity reference and source
9. Audit records are immutable — no API or user action can modify or delete them (NFR13)
10. `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting any new concepts, patterns, or configurations introduced in this story

## Tasks / Subtasks

**Tasks are sequential — each depends on the previous. Do not parallelize.**

- [x]Task 0: Gate check — verify prerequisites (AC: all)
  - [x]0.1 Run `npm run test` — all existing tests pass
  - [x]0.2 Run `npm run lint` — no lint errors
  - [x]0.3 Run `npx prisma validate` — schema valid
  - [x]0.4 Verify `src/server/middleware/action-client.ts` exists with `authedAction` and `ownerAction` chains
  - [x]0.5 Verify `src/types/caller-identity.ts` has `source: "web" | "api" | "system" | "seed"`

- [x]Task 1: Create `audit_logs` Prisma model and migration (AC: 1, 2, 3)
  - [x]1.1 Add `AuditLog` model to `prisma/schema/app.prisma` (see Prisma Model Specification below)
  - [x]1.2 Run `npx prisma migrate dev --name add-audit-logs`
  - [x]1.3 Add RLS + immutability SQL to the generated migration file (see Migration SQL section below for exact SQL)
  - [x]1.4 Re-run migration: `npx prisma migrate dev` to apply the edited migration
  - [x]1.5 Verify migration applies cleanly and `npx prisma validate` passes

- [x]Task 2: Update CallerIdentity type and create audit service (AC: 4, 5)
  - [x]2.1 Update `src/types/caller-identity.ts`: change source union to `"web" | "mcp" | "cli" | "system" | "seed"`
  - [x]2.2 Create `src/types/audit.ts` with `AuditLogger` type definition (see Audit Context Pattern below)
  - [x]2.3 Create `src/server/services/audit.ts` with `createAuditEntry()` function
  - [x]2.4 Implement `getAuditLog()` for read access (future use)

- [x]Task 3: Add audit context helper to Server Action pipeline (AC: 4, 5)
  - [x]3.1 Add audit context `.use()` step in `action-client.ts` chain: auth → rateLimit → tenant → **audit**
  - [x]3.2 The audit context provides `ctx.audit.log()` — an opt-in function services call explicitly (NOT automatic middleware that wraps every action)
  - [x]3.3 If `ctx.callerIdentity.source === "seed"`, provide a no-op audit logger (skip audit for seed operations)
  - [x]3.4 Update `src/server/services/settings.ts`: add `audit: AuditLogger` parameter to `updateTenantProfile` and call `audit.log()` after mutation
  - [x]3.5 Update `src/server/actions/settings.ts`: pass `ctx.audit` to service calls
  - [x]3.6 Update `src/server/db/test-fixtures.ts`: add `audit_logs` to `cleanupTestData` TRUNCATE list (TRUNCATE bypasses PostgreSQL RULEs — this works fine; DELETE would be silently dropped)

- [x]Task 4a: Infrastructure integration tests (AC: 6, 7, 9)
  - [x]4a.1 In `src/server/services/audit.test.ts`: test UPDATE on audit_logs via raw SQL — assert 0 rows affected (not an exception)
  - [x]4a.2 Test DELETE on audit_logs via raw SQL — assert 0 rows affected, original data intact
  - [x]4a.3 Test RLS isolation — Tenant B cannot read Tenant A's audit logs
  - [x]4a.4 Test RLS INSERT isolation — attempt to INSERT audit entry with tenantId different from `SET LOCAL` value, assert it fails (WITH CHECK violation)
  - [x]4a.5 Each test file must be self-contained with own setup/teardown — no shared state between test suites

- [x]Task 4b: Behavioral integration tests (AC: 8)
  - [x]4b.1 In `src/server/services/settings.test.ts`: update existing tests to pass audit context (new `audit` parameter on service methods)
  - [x]4b.2 Test that calling `updateTenantProfile` produces a correct audit entry with correct entityType, entityId, source, userId, tenantId
  - [x]4b.3 Test audit entry oldData contains previous values, newData contains updated values
  - [x]4b.4 Test transaction rollback: when service returns an AppError, no audit entry is created (both mutation and audit roll back together)
  - [x]4b.5 Test seed source: when CallerIdentity.source is "seed", no audit entry is created

- [x]Task 5: Update documentation (AC: 10)
  - [x]5.1 Create `docs/audit-trail.md` with architecture, patterns, and usage guide
  - [x]5.2 Include note: planned audit UI surface in future stories (UX spec: "audit trail accessible" for user confidence)
  - [x]5.3 Include note: future enhancement — consider replacing `DO INSTEAD NOTHING` rules with trigger functions that log tampering attempts
  - [x]5.4 Update `docs/index.md` with link to audit trail docs

- [x]Task 6: Final verification
  - [x]6.1 Run `npm run test` — all tests pass (existing + new)
  - [x]6.2 Run `npm run lint` — no lint errors (run `npx biome check --write` first)
  - [x]6.3 Run `npm run e2e` — existing E2E tests still pass
  - [x]6.4 Verify dev server starts and settings page still works

## Dev Notes

### Audit Context Pattern

This is an **opt-in context helper**, not automatic interceptor middleware. Services call `audit.log()` explicitly when performing mutations.

```typescript
// src/types/audit.ts
export type AuditLogger = {
  log: (params: {
    action: "create" | "update" | "delete"
    entityType: string
    entityId: string
    oldData?: Record<string, unknown> | null
    newData?: Record<string, unknown> | null
  }) => Promise<void>
}
```

```typescript
// In action-client.ts, add after tenant middleware:
.use(async ({ ctx, next }) => {
  const isNoOp = ctx.callerIdentity.source === "seed"
  const audit: AuditLogger = {
    log: async (params) => {
      if (isNoOp) return // Skip audit for seed operations
      await ctx.tx.auditLog.create({
        data: {
          tenantId: ctx.callerIdentity.tenantId,
          userId: ctx.callerIdentity.userId,
          source: ctx.callerIdentity.source,
          ...params,
        },
      })
    },
  }
  return next({ ctx: { ...ctx, audit } })
})
```

**Why opt-in, not automatic:**
1. Read actions (queries) don't need audit entries
2. The middleware doesn't know entityType/entityId until the service runs
3. oldData requires a read-before-write that only the service knows how to do

**Warning — no automated enforcement:** If a dev forgets to call `audit.log()` in a mutation service, there is no error and no audit entry. This relies on code review to catch omissions. Every new mutation service MUST call `audit.log()`.

### Service Integration Example

```typescript
// In settings service — updated signature adds audit parameter:
export async function updateTenantProfile(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: UpdateTenantProfileInput
): Promise<ServiceResult<TenantProfile>> {
  const old = await tx.tenant.findUnique({ where: { id: caller.tenantId } })
  const updated = await tx.tenant.update({ ... })
  await audit.log({
    action: "update",
    entityType: "tenant",
    entityId: caller.tenantId,
    oldData: toAuditData(old),   // Strip Prisma internals — see Data Hygiene below
    newData: toAuditData(updated),
  })
  return { data: updated }
}
```

**Breaking change:** Adding `audit` to the service signature changes the contract. Existing tests in `settings.test.ts` will break and must be updated to pass the audit context. This pattern applies to ALL future mutation services — `audit: AuditLogger` becomes a standard parameter after `caller: CallerIdentity`.

### Scope Guard

- **Only audit Prisma models in `app.prisma`** — NOT Better Auth models (`User`, `Session`, `Organization`, `Member` in `auth.prisma`). Better Auth manages its own tables; attempting to audit them would require bypassing the auth layer's own transaction boundaries.
- This story wires audit into `updateTenantProfile` only. Other services add audit calls in their own stories.

### Data Hygiene for oldData/newData

Prisma query results include relation fields, `_count`, and other metadata depending on the query. **Strip Prisma internals before storing as JSONB.** Use explicit field picking:

```typescript
function toAuditData(record: unknown): Record<string, unknown> | null {
  if (!record) return null
  const { id, ...fields } = record as Record<string, unknown>
  // Return only plain data fields — no relations, no _count, no Prisma metadata
  return Object.fromEntries(
    Object.entries(fields).filter(([_, v]) => v !== undefined && typeof v !== 'object' || v === null || v instanceof Date || v instanceof Decimal)
  )
}
```

**Future note for Story 2.2:** Prisma `Decimal` fields serialize to JSONB as `{"$type":"Decimal","value":"123.45"}` or similar. When audit logs capture entities with Decimal fields, verify the JSON representation is human-readable.

### Read-Before-Write Pattern

The `findUnique` before `update` pattern works for single-record mutations like `updateTenantProfile`. **Do NOT cargo-cult this into bulk operations** — for batch mutations in future stories, the approach will differ (e.g., store only changed fields, or skip oldData for bulk). This story sets the single-record pattern only.

### Architecture Constraints

- **Hexagonal architecture**: audit service in `src/server/services/audit.ts` — MUST NOT import from `next/*` or `src/components/*`
- **CallerIdentity** is already passed through every service call — it contains `userId`, `tenantId`, `role`, and `source` fields needed for audit entries
- **RLS is mandatory** — audit_logs MUST have tenant isolation via RLS, same pattern as tenant_configs
- **PostgreSQL-level immutability** — use `CREATE RULE` to prevent UPDATE and DELETE (not application-level checks). This is the same approach planned for `ecb_rates` in Story 2.3
- **Transaction atomicity** — audit entries MUST be written in the same transaction as the mutation (via `withTenantTransaction`). If the mutation fails, the audit entry rolls back too — this is the critical correctness guarantee

### Prisma Model Specification

```prisma
model AuditLog {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  action     String   // 'create' | 'update' | 'delete'
  entityType String   @map("entity_type") // e.g., 'tenant_config', 'tenant'
  entityId   String   @map("entity_id")   // Plain String, not @db.Uuid — future entities may have non-UUID IDs
  oldData    Json?    @map("old_data") @db.JsonB
  newData    Json?    @map("new_data") @db.JsonB
  source     String   // 'web' | 'mcp' | 'cli' | 'system'
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz

  // NO updatedAt — audit logs are immutable
  // NO tenant relation — audit_logs should not cascade-delete with tenant

  @@index([tenantId, entityType, entityId])
  @@index([tenantId, createdAt])
  @@index([tenantId, userId])
  @@map("audit_logs")
}
```

**Critical notes on the model:**
- `entityId` is plain `String` (not `@db.Uuid`) — future entities may use composite or non-UUID keys
- `Json?` with `@db.JsonB` — nullable because creates have no oldData, deletes have no newData
- NO `updatedAt` field — immutable records never update
- NO foreign key to `tenants` table — audit logs must survive even if tenant data changes; RLS provides isolation
- Three indexes: entity lookup, chronological queries, and user activity queries (needed for dashboard in Story 2.5)

### Migration SQL

**Add this to the generated migration file in Task 1.3:**

```sql
-- RLS policy with WITH CHECK to prevent cross-tenant INSERT
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Immutability: prevent UPDATE and DELETE (silently drops — does NOT throw)
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
```

**Important:** `TRUNCATE` bypasses PostgreSQL RULEs — test cleanup via TRUNCATE works fine. If you use `DELETE FROM audit_logs` in cleanup instead of TRUNCATE, it will be silently dropped and tests will leak state.

### Existing Code to Modify

| File | Change |
|------|--------|
| `prisma/schema/app.prisma` | Add AuditLog model |
| `src/types/caller-identity.ts` | Add `'mcp'`, `'cli'` to source union |
| `src/types/audit.ts` | New file: `AuditLogger` type definition |
| `src/server/middleware/action-client.ts` | Add audit context `.use()` step to chain |
| `src/server/services/settings.ts` | Add `audit: AuditLogger` param to `updateTenantProfile`, call `audit.log()` |
| `src/server/actions/settings.ts` | Pass `ctx.audit` to service calls |
| `src/server/db/test-fixtures.ts` | Add `audit_logs` to `cleanupTestData` TRUNCATE list |
| `src/server/services/settings.test.ts` | Update existing tests for new audit param + add audit behavioral tests |

### Testing Approach

- **Infrastructure tests** in `src/server/services/audit.test.ts`: DB-level immutability (UPDATE/DELETE rules assert 0 rows affected), RLS read isolation, RLS INSERT isolation (WITH CHECK violation)
- **Behavioral tests** in `src/server/services/settings.test.ts`: audit entries created on mutation, correct field values, transaction rollback produces no audit entry, seed source produces no audit entry
- **Test isolation**: each test file must be self-contained with own setup/teardown — no shared state between test suites
- **Use existing test infrastructure**: `createAuthenticatedContext()`, `withTenantTransaction()`, `cleanupTestData()`
- **PostgreSQL RULE behavior**: `DO INSTEAD NOTHING` silently drops the operation — tests verify 0 rows affected and original data intact, NOT exceptions

### Source Provenance Alignment

Update `CallerIdentity.source` type from `"web" | "api" | "system" | "seed"` to `"web" | "mcp" | "cli" | "system" | "seed"`:
- `"mcp"` and `"cli"` are architecture-canonical sources for future entry points
- `"api"` can be removed if unused, or kept for backward compat — check usages first
- `"seed"` is used in test fixtures — keep it, but audit skips seed operations

### Project Structure Notes

- All new files follow existing kebab-case naming convention
- New files: `src/server/services/audit.ts`, `src/types/audit.ts`, `docs/audit-trail.md`
- Modified files stay in their existing locations
- No new npm dependencies required — uses Prisma's built-in JSON support

### Previous Epic Intelligence

From Epic 1 retrospective:
- Always run `npx biome check --write` before committing (CI lint catches formatting issues)
- Use existing test patterns from `settings.test.ts` — they work reliably
- The `createAuthenticatedContext()` fixture handles full auth setup including organization
- RLS test patterns in `tenant-client.test.ts` are comprehensive — follow the same approach for audit RLS tests

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Server Action Pipeline, D3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Naming Patterns, Implementation Consistency]
- [Source: _bmad-output/planning-artifacts/architecture.md — Test Architecture]
- [Source: _bmad-output/planning-artifacts/prd.md — FR45, FR46, NFR13]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Immutable Audit Trail, Source Provenance]
- [Source: src/server/middleware/action-client.ts — existing middleware chain]
- [Source: src/server/services/settings.ts — production service pattern]
- [Source: src/server/db/tenant-client.ts — RLS transaction wrapper]
- [Source: prisma/schema/app.prisma — existing model patterns]
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-03-11.md — CI/testing lessons]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- DB reset required after editing migration file to add RLS SQL (migration already applied before edit)
- `src/generated/` is gitignored — Prisma client regeneration needed after adding AuditLog model
- Init migration grants `GRANT ALL` on tables but missing `GRANT USAGE ON SCHEMA` — needed manual fix after reset for seed to work

### Completion Notes List
- ✅ AuditLog Prisma model with 3 indexes (entity lookup, chronological, user activity)
- ✅ RLS policy with USING + WITH CHECK for tenant isolation on both read and write
- ✅ PostgreSQL RULEs for immutability (silently drop UPDATE and DELETE)
- ✅ CallerIdentity source updated: `"api"` → `"mcp" | "cli"` per architecture spec
- ✅ AuditLogger type and audit service (createAuditEntry + getAuditLog)
- ✅ Audit middleware in action pipeline: auth → rateLimit → tenant → audit
- ✅ Seed source gets no-op audit logger
- ✅ updateTenantProfile wired with read-before-write + audit.log()
- ✅ 4 infrastructure tests: UPDATE/DELETE immutability, RLS read isolation, RLS INSERT isolation
- ✅ 4 behavioral tests: audit entry fields, oldData/newData, transaction rollback, seed skip
- ✅ Documentation with Obsidian wiki-links
- ✅ All 62 tests pass, lint clean, 4 E2E tests pass

### File List
- `prisma/schema/app.prisma` — Added AuditLog model
- `prisma/migrations/20260311020619_add_audit_logs/migration.sql` — New migration with RLS + rules
- `src/types/caller-identity.ts` — Updated source union
- `src/types/audit.ts` — New: AuditLogger type
- `src/server/services/audit.ts` — New: createAuditEntry, getAuditLog
- `src/server/middleware/action-client.ts` — Added audit middleware to chain
- `src/server/services/settings.ts` — Added audit param + toAuditData helper
- `src/server/actions/settings.ts` — Pass ctx.audit to service
- `src/server/db/test-fixtures.ts` — Added audit_logs to TRUNCATE list
- `src/server/services/audit.test.ts` — New: 4 infrastructure integration tests
- `src/server/services/settings.test.ts` — Updated + 4 new behavioral audit tests
- `docs/audit-trail.md` — New: audit trail documentation
- `docs/index.md` — Added audit-trail link

### Change Log
- 2026-03-11: Story 2.1 implemented — audit trail infrastructure with immutable logs, RLS isolation, opt-in service pattern, and comprehensive tests
