# Prisma & RLS Setup

Multi-tenant database isolation using Prisma 7 with PostgreSQL Row Level Security.

## Multi-File Schema

Prisma schema is split across `prisma/schema/`:

- `auth.prisma` — Generator, datasource, auth models (owned by Better Auth after Story 1.3)
- `app.prisma` — Domain models (our code, follows mandatory template)

Configuration lives in `prisma.config.ts` at project root. Prisma 7 multi-file schema is GA — no preview flag needed.

## RLS Pattern

Every tenant-scoped table uses PostgreSQL RLS with `FORCE`:

```sql
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table_name>
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

`FORCE ROW LEVEL SECURITY` is critical — without it, the table owner role bypasses RLS entirely.

## Dual Database Roles

| Role | Purpose | Connection |
|------|---------|------------|
| `af` (superuser) | Migrations, TRUNCATE, admin ops | `DATABASE_MIGRATION_URL` |
| `af_app` (app role) | Runtime queries, RLS enforced | `DATABASE_URL` |

The app **never** connects as superuser in production.

New migrations grant to `af_app` (renamed from v2's `defterfab_app` inside the existing migrations, D42).

## Tenant-Aware Client

All tenant-scoped database access goes through `src/kernel/db/tenant-client.ts`:

```typescript
import { withTenantTransaction } from "@/server/db/tenant-client";

const configs = await withTenantTransaction(prisma, tenantId, async (tx) => {
  return tx.tenantConfig.findMany();
});
```

### How It Works

1. Prisma `$transaction` (interactive) acquires a single DB connection
2. `SET LOCAL app.tenant_id = '<uuid>'` scopes the variable to that transaction only
3. PostgreSQL RLS policies filter all queries to the scoped tenant
4. On commit/rollback, `SET LOCAL` is automatically cleared — safe for connection pooling

### One query at a time (F53)

One transaction is one pg client, and a pg client runs one query at a time. Inside the callback the awaits go one after the other — never `Promise.all` / `allSettled` / `any` / `race` over `tx` (pg queues the overlap anyway, so nothing is gained, and warns *client.query() while already executing*, which pg@9 removes). A list goes through `mapInOrder(items, fn)` from the same file. `src/kernel/guards/one-client.guard.test.ts` fails a file that touches a transaction and calls `Promise.all`; its allow-list holds the few files whose parallel work runs on separate clients. [[lessons]]

### Raw SQL Access

For queries outside Prisma's ORM, use `withTenantConnection`:

```typescript
import { withTenantConnection } from "@/server/db/tenant-client";

const rows = await withTenantConnection(pool, tenantId, async (client) => {
  const res = await client.query("SELECT * FROM tenant_configs WHERE key = $1", ["lang"]);
  return res.rows;
});
```

## Schema ↔ migrations drift

Migrations are hand-written here (RLS, grants, rules, partial indexes), so the Prisma schema must describe **exactly** what they create — column types (`@db.VarChar(n)`), `@default(now())` on `updated_at`, constraint names via `map:`, referential actions (`onDelete`/`onUpdate: NoAction` when the SQL has none), and every table the raw SQL uses (`DocumentKeyCounter`). Reconciled on 2026-10-20 after `migrate dev` tried to "repair" the database.

Check before any schema change (expects "Already in sync"):

```bash
npx prisma migrate dev --create-only --name drift_check   # then delete the folder if it created one
```

Partial indexes (`idx_partners_tenant_org … WHERE org_number IS NOT NULL`) are declared as plain `@@unique(..., map:)` — Prisma cannot express the predicate, and Postgres unique indexes already allow multiple NULLs, so behaviour is identical.

## Adding New Tables

1. Define model in `prisma/schema/app.prisma` following the [[conventions#prisma-model-template|mandatory template]]
2. Run `npx prisma migrate dev --name <description>`
3. **Before applying:** Append RLS statements to the generated migration SQL
4. Re-run `npx prisma migrate dev` to apply
5. Add integration tests in a co-located `.test.ts` file

## Test Infrastructure

- `src/kernel/db/test-setup.ts` — Global setup: runs migrations against test DB
- `src/kernel/db/test-fixtures.ts` — Factory functions: `createTestTenant()`, `createTestUser()`, `createTestTenantConfig()`
- `src/kernel/db/tenant-client.test.ts` — RLS isolation integration tests

Tests use two pools:
- **Admin pool** (superuser) — test data setup, TRUNCATE cleanup
- **App pool** (`af_app`) — RLS-enforced queries under test

### Running Tests

```bash
docker compose up -d          # Start dev + test databases
npm run test                  # All tests
npx vitest --project server    # DB-backed tests (kernel + modules)
```

## Auth Tables — No RLS

Auth tables (`users`, `sessions`, `accounts`, `organizations`, `members`, `invitations`, `verifications`) **MUST NOT** have RLS policies. They are global cross-tenant tables owned by Better Auth. Adding RLS to them will break authentication silently. See [[auth-setup]] for details.

## Technical Decisions

- **SET LOCAL (not SET):** `SET` persists for the session, leaking tenant context across requests in a connection pool. `SET LOCAL` is transaction-scoped.
- **UUID validation:** PostgreSQL `SET` doesn't support parameterized queries (`$1`). We validate UUID format with regex before string interpolation to prevent SQL injection.
- **$transaction (not $extends):** Prisma interactive transactions hold a single DB connection, making `SET LOCAL` reliable. The `$extends`+`$allOperations` approach was less predictable with Driver Adapters.
- **WASM engine:** Prisma 7 defaults to WASM engine with Driver Adapters — no special config needed.

For how RLS is activated at runtime via the Server Action middleware chain, see [[server-actions]].
