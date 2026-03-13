# Config Page Test Template

Reusable test structure for settings/configuration CRUD pages (Stories 3.1–3.4). Each config entity follows the same patterns.

## Test Structure

### 1. Service-Level CRUD Tests

Test the service layer directly with `withTenantTransaction`:

```typescript
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import {
  cleanupTestData,
  createTestTenant,
  createTestUser,
} from "@/server/db/test-fixtures";
import {
  assertAuditLogged,
  assertCrudOperations,
  assertRlsIsolation,
} from "@/server/test-utils/config-crud-helpers";

const ADMIN_URL = process.env.DATABASE_TEST_MIGRATION_URL
  || "postgresql://defterfab:test@localhost:5433/defterfab_test";

let adminPool: Pool;
let tenantA: { id: string };
let tenantB: { id: string };
let userA: { id: string };

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  tenantA = await createTestTenant(adminPool, { name: "Tenant A" });
  tenantB = await createTestTenant(adminPool, { name: "Tenant B" });
  userA = await createTestUser(adminPool, { name: "User A" });
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

describe("ConfigEntity service", () => {
  it("creates a config entity", async () => {
    const result = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      return configEntityService.create(tx, callerIdentity, { /* data */ });
    });
    expect(result.id).toBeDefined();
  });

  it("reads config entities for tenant", async () => { /* ... */ });
  it("updates a config entity", async () => { /* ... */ });
  it("deletes a config entity", async () => { /* ... */ });

  it("validates duplicate prevention", async () => {
    // Create first entity
    // Attempt duplicate — expect AppError with CONFLICT code
  });

  it("validates required fields", async () => {
    // Attempt create with missing required field
    // Expect AppError with VALIDATION code
  });
});
```

### 2. RLS Isolation Tests

Use `assertRlsIsolation` from config-crud-helpers:

```typescript
describe("RLS isolation", () => {
  it("tenant B cannot see tenant A's config entities", async () => {
    // Create entity for tenant A
    await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      await configEntityService.create(tx, callerA, { /* data */ });
    });

    await assertRlsIsolation(prisma, "configEntity", tenantA.id, tenantB.id);
  });

  it("tenant B cannot update tenant A's config entities", async () => {
    // Similar pattern to tenant-client.test.ts update isolation tests
  });

  it("tenant B cannot delete tenant A's config entities", async () => {
    // Similar pattern to tenant-client.test.ts delete isolation tests
  });
});
```

### 3. Audit Log Assertions

Use `assertAuditLogged` from config-crud-helpers:

```typescript
describe("audit logging", () => {
  it("logs create action", async () => {
    const entity = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      return configEntityService.create(tx, callerA, { /* data */ });
    });
    await assertAuditLogged(adminPool, tenantA.id, "create", "config_entity", entity.id);
  });

  it("logs update action with old/new data", async () => { /* ... */ });
  it("logs delete action", async () => { /* ... */ });

  it("does not log audit for seed source", async () => {
    // CallerIdentity with source: "seed" should skip audit
  });
});
```

### 4. Server Action Tests

Test actions return `AppError` objects (never throw):

```typescript
import { vi } from "vitest";
import { auth } from "@/server/auth";
import { createAuthenticatedContext } from "@/server/db/test-fixtures";

// Mock next/headers
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

describe("ConfigEntity actions", () => {
  it("owner can create via action", async () => {
    const { headers } = await createAuthenticatedContext(auth, "owner");
    mockHeaders = headers;
    const result = await createConfigEntityAction({ /* input */ });
    expect(result?.data?.error).toBeUndefined();
  });

  it("accountant gets FORBIDDEN for write actions", async () => {
    // Use ownerAction for write operations — accountant should fail
  });
});
```

### 5. Auto-Save Behavior Pattern

Config pages use auto-save (no explicit save button):

- **Toggle/Select fields**: Save on `onChange`
- **Text fields**: Save on `onBlur` (when user tabs away)

Reference implementation: `src/components/domain/company-profile-form.tsx`

Key pattern:
```typescript
const { executeAsync } = useAction(updateConfigEntity);

const saveField = async (field: string, value: string) => {
  if (value === previousData.current[field]) return; // Skip unchanged
  setSavingField(field);
  const result = await executeAsync({ [field]: value });
  if (result?.data?.error) {
    setErrors({ [field]: result.data.error.message });
  } else {
    previousData.current = { ...previousData.current, [field]: value };
  }
  setSavingField(null);
};
```

### 6. Empty State Handling

- Config pages must handle the case where no entities exist yet
- Show a helpful empty state message with a "Create first" CTA
- List views should not error on zero results

## Helper Functions Reference

Import from `@/server/test-utils/config-crud-helpers`:

| Function | Purpose |
|----------|---------|
| `assertRlsIsolation(prisma, model, tenantAId, tenantBId)` | Verify tenant B sees 0 rows after tenant A creates data |
| `assertCrossTableRlsIsolation(prisma, parentModel, childModel, tenantAId, tenantBId, includeRelation)` | Verify RLS isolation across FK-joined tables (Epic 4+) |
| `assertAuditLogged(adminPool, tenantId, action, entityType, entityId?)` | Verify audit_logs entry exists |
| `assertCrudOperations(operations)` | Run full create/read/update/delete cycle |

### Cross-Table RLS Isolation (Epic 4+)

For stories with inter-entity FK relationships (e.g., Partner → VatRegistration), use `assertCrossTableRlsIsolation`:

```typescript
describe("cross-table RLS isolation", () => {
  it("tenant B cannot see tenant A's partners with included relations", async () => {
    await assertCrossTableRlsIsolation(
      prisma,
      "partner",                    // parent model
      "defaultVatRegistration",     // child model
      tenantA.id,
      tenantB.id,
      "defaultVatRegistration",     // include relation name
    );
  });
});
```

**Important:** FK constraints bypass RLS (PostgreSQL design). Service-level validation must verify FK targets belong to the same tenant before writes. See `docs/cross-table-rls.md` for full spike findings.
