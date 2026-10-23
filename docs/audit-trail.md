# Audit Trail

Immutable, tenant-isolated audit trail capturing every mutation with source provenance.

## Overview

Every state-changing operation in AF records an audit entry in the `audit_logs` table. This provides a complete, tamper-proof history of all changes for legal compliance and accountability.

**Key properties:**
- **Immutable** — PostgreSQL RULEs silently prevent UPDATE and DELETE operations
- **Tenant-isolated** — RLS policies enforce that each tenant can only access their own audit logs
- **Transactional** — Audit entries are written in the same transaction as the mutation; if the mutation fails, the audit entry rolls back too
- **Source-tracked** — Every entry records whether the action originated from `web`, `mcp`, `cli`, or `system`

## Architecture

### Opt-in Context Helper

Audit logging uses an **opt-in pattern**, not automatic middleware. The [[server-actions]] middleware chain provides an `audit` context object with a `log()` function. Services call `audit.log()` explicitly after mutations.

```
Server Action → auth → rateLimit → tenant → audit → handler
```

**Why opt-in, not automatic:**
1. Read actions (queries) don't need audit entries
2. The middleware doesn't know `entityType`/`entityId` until the service runs
3. `oldData` requires a read-before-write that only the service knows how to do

### Service Integration

Every mutation service receives an `audit: AuditLogger` parameter and calls `audit.log()` after the mutation:

```typescript
export async function updateTenantProfile(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: UpdateTenantProfileInput
) {
  const old = await tx.tenant.findUnique({ where: { id: caller.tenantId } });
  const updated = await tx.tenant.update({ ... });
  await audit.log({
    action: "update",
    entityType: "tenant",
    entityId: caller.tenantId,
    oldData: toAuditData(old),
    newData: toAuditData(updated),
  });
}
```

### Data Hygiene

The `toAuditData()` helper strips Prisma internals (relations, `_count`, metadata) before storing as JSONB. Only plain data fields are stored.

What lands in `old_data` / `new_data` (`auditDataToJson`, the write mapper, F50-g): the record's JSON form — dates as ISO strings, decimals as strings, undefined fields dropped. An omitted `oldData` / `newData` is SQL NULL; an explicit `null` is the JSON `null` (both kept as the former casts wrote them; `audit.test.ts` pins them). Known gap: `toAuditData` also drops `Prisma.Decimal` fields, so money rows are audited without their amounts — **F84**.

### Seed Operations

When `CallerIdentity.source === "seed"`, the audit middleware provides a no-op logger that silently skips audit entry creation. Seed operations are not real user actions and should not appear in the audit trail.

## Database Design

### Table: `audit_logs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant that owns this audit entry |
| `user_id` | UUID | User who performed the action |
| `action` | TEXT | `create`, `update`, `delete`, `deactivate` or `reactivate` |
| `entity_type` | TEXT | e.g., `tenant`, `tenant_config` |
| `entity_id` | TEXT | ID of the affected entity (not necessarily UUID) |
| `old_data` | JSONB | Previous state (null for creates) |
| `new_data` | JSONB | New state (null for deletes) |
| `source` | TEXT | `web`, `mcp`, `cli`, or `system` (`seed` operations skip audit) |
| `created_at` | TIMESTAMPTZ | When the action occurred |

### Indexes

- `(tenant_id, entity_type, entity_id)` — Entity lookup
- `(tenant_id, created_at)` — Chronological queries
- `(tenant_id, user_id)` — User activity queries

### Immutability

PostgreSQL RULEs prevent modification:
```sql
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
```

Note: `TRUNCATE` bypasses these rules — used only in test cleanup.

### RLS

```sql
CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Important Notes

- **No automated enforcement:** If a dev forgets to call `audit.log()` in a mutation service, there is no error and no audit entry. Code review must catch omissions.
- **Only app models:** Audit covers Prisma models in `app.prisma` — NOT Better Auth models (`User`, `Session`, `Organization`, `Member`).
- **Planned UI:** Audit trail will be accessible through a future dashboard surface for user confidence and accountability (see UX design specification in planning artifacts).
- **Future enhancement:** Consider replacing `DO INSTEAD NOTHING` rules with trigger functions that log tampering attempts.
