import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withTenantConnection, withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createTestTenant,
  createTestTenantConfig,
  createTestUser,
} from "@/kernel/db/test-fixtures";

// Superuser pool for admin operations (TRUNCATE, test data setup — bypasses RLS)
const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

// Non-superuser pool for RLS-enforced operations (app role)
const APP_DATABASE_URL =
  process.env.DATABASE_TEST_URL || "postgresql://af_app:app@localhost:5433/af_test";

let adminPool: Pool;
let appPool: Pool;
let prisma: PrismaClient;

// Test UUIDs
let tenantA: { id: string; name: string };
let tenantB: { id: string; name: string };
let userA: { id: string; email: string; name: string };
let userB: { id: string; email: string; name: string };

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  appPool = new Pool({ connectionString: APP_DATABASE_URL });
  const adapter = new PrismaPg(appPool);
  prisma = new PrismaClient({ adapter });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);

  // Create two tenants and users for isolation testing (admin bypasses RLS)
  tenantA = await createTestTenant(adminPool, { name: "Tenant A" });
  tenantB = await createTestTenant(adminPool, { name: "Tenant B" });
  userA = await createTestUser(adminPool, { name: "User A" });
  userB = await createTestUser(adminPool, { name: "User B" });
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await prisma.$disconnect();
  await appPool.end();
  await adminPool.end();
});

describe("withTenantTransaction", () => {
  describe("basic RLS isolation", () => {
    it("returns data only for the scoped tenant", async () => {
      // Create config for Tenant A
      await createTestTenantConfig(adminPool, tenantA.id, userA.id, {
        key: "lang",
        value: "sv",
      });

      // Query as Tenant A — should see data
      const resultA = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
        return tx.tenantConfig.findMany();
      });
      expect(resultA).toHaveLength(1);
      expect(resultA[0].key).toBe("lang");

      // Query as Tenant B — should see nothing
      const resultB = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
        return tx.tenantConfig.findMany();
      });
      expect(resultB).toHaveLength(0);
    });

    it("prevents Tenant B from reading Tenant A's data", async () => {
      await createTestTenantConfig(adminPool, tenantA.id, userA.id, {
        key: "secret",
        value: "sensitive-data",
      });

      const result = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
        return tx.tenantConfig.findMany({
          where: { key: "secret" },
        });
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("insert isolation", () => {
    it("inserts data scoped to the correct tenant", async () => {
      await withTenantTransaction(prisma, tenantA.id, async (tx) => {
        await tx.tenantConfig.create({
          data: {
            tenantId: tenantA.id,
            key: "inserted-by-a",
            value: "hello",
            createdBy: userA.id,
            source: "manual",
          },
        });
      });

      // Count as Tenant A — should see 1
      const countA = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
        return tx.tenantConfig.count();
      });
      expect(countA).toBe(1);

      // Count as Tenant B — should see 0
      const countB = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
        return tx.tenantConfig.count();
      });
      expect(countB).toBe(0);
    });
  });

  describe("update isolation", () => {
    it("prevents Tenant B from updating Tenant A's data", async () => {
      await createTestTenantConfig(adminPool, tenantA.id, userA.id, {
        key: "update-test",
        value: "original",
      });

      // Attempt update as Tenant B — should affect 0 rows
      const updateResult = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
        return tx.tenantConfig.updateMany({
          where: { key: "update-test" },
          data: { value: "hacked" },
        });
      });
      expect(updateResult.count).toBe(0);

      // Verify original data unchanged
      const original = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
        return tx.tenantConfig.findFirst({
          where: { key: "update-test" },
        });
      });
      expect(original?.value).toBe("original");
    });
  });

  describe("delete isolation", () => {
    it("prevents Tenant B from deleting Tenant A's data", async () => {
      await createTestTenantConfig(adminPool, tenantA.id, userA.id, {
        key: "delete-test",
        value: "keep-me",
      });

      // Attempt delete as Tenant B — should affect 0 rows
      const deleteResult = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
        return tx.tenantConfig.deleteMany({
          where: { key: "delete-test" },
        });
      });
      expect(deleteResult.count).toBe(0);

      // Verify data still exists for Tenant A
      const stillExists = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
        return tx.tenantConfig.findFirst({
          where: { key: "delete-test" },
        });
      });
      expect(stillExists).not.toBeNull();
      expect(stillExists?.value).toBe("keep-me");
    });
  });

  describe("own data access", () => {
    it("allows a tenant to access its own data", async () => {
      await createTestTenantConfig(adminPool, tenantA.id, userA.id, {
        key: "my-setting",
        value: "my-value",
      });

      const result = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
        return tx.tenantConfig.findFirst({
          where: { key: "my-setting" },
        });
      });
      expect(result).not.toBeNull();
      expect(result?.value).toBe("my-value");
      expect(result?.tenantId).toBe(tenantA.id);
    });
  });

  describe("tenant table RLS", () => {
    it("only returns the scoped tenant from the tenants table", async () => {
      const tenantsForA = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
        return tx.tenant.findMany();
      });
      expect(tenantsForA).toHaveLength(1);
      expect(tenantsForA[0].id).toBe(tenantA.id);

      const tenantsForB = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
        return tx.tenant.findMany();
      });
      expect(tenantsForB).toHaveLength(1);
      expect(tenantsForB[0].id).toBe(tenantB.id);
    });
  });
});

describe("concurrent connection isolation", () => {
  it("maintains isolation under parallel queries from different tenants", async () => {
    // Create data for both tenants
    await createTestTenantConfig(adminPool, tenantA.id, userA.id, {
      key: "concurrent-a",
      value: "value-a",
    });
    await createTestTenantConfig(adminPool, tenantB.id, userB.id, {
      key: "concurrent-b",
      value: "value-b",
    });

    // Run queries in parallel
    const [resultA, resultB] = await Promise.all([
      withTenantTransaction(prisma, tenantA.id, async (tx) => {
        return tx.tenantConfig.findMany();
      }),
      withTenantTransaction(prisma, tenantB.id, async (tx) => {
        return tx.tenantConfig.findMany();
      }),
    ]);

    // Tenant A only sees its data
    expect(resultA).toHaveLength(1);
    expect(resultA[0].key).toBe("concurrent-a");
    expect(resultA[0].tenantId).toBe(tenantA.id);

    // Tenant B only sees its data
    expect(resultB).toHaveLength(1);
    expect(resultB[0].key).toBe("concurrent-b");
    expect(resultB[0].tenantId).toBe(tenantB.id);
  });

  it("prevents cross-contamination during parallel inserts and reads", async () => {
    // Both tenants insert and read simultaneously
    const [countA, countB] = await Promise.all([
      withTenantTransaction(prisma, tenantA.id, async (tx) => {
        await tx.tenantConfig.create({
          data: {
            tenantId: tenantA.id,
            key: "parallel-insert-a",
            value: "a",
            createdBy: userA.id,
            source: "manual",
          },
        });
        return tx.tenantConfig.count();
      }),
      withTenantTransaction(prisma, tenantB.id, async (tx) => {
        await tx.tenantConfig.create({
          data: {
            tenantId: tenantB.id,
            key: "parallel-insert-b",
            value: "b",
            createdBy: userB.id,
            source: "manual",
          },
        });
        return tx.tenantConfig.count();
      }),
    ]);

    // Each tenant should see exactly 1 record (their own)
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});

describe("withTenantConnection (raw pg)", () => {
  it("enforces RLS via raw pg connection", async () => {
    await createTestTenantConfig(adminPool, tenantA.id, userA.id, {
      key: "raw-test",
      value: "raw-value",
    });

    // Query as Tenant A via raw pg — should see data
    const resultA = await withTenantConnection(appPool, tenantA.id, async (client) => {
      const res = await client.query("SELECT * FROM tenant_configs WHERE key = $1", ["raw-test"]);
      return res.rows;
    });
    expect(resultA).toHaveLength(1);
    expect(resultA[0].value).toBe("raw-value");

    // Query as Tenant B via raw pg — should see nothing
    const resultB = await withTenantConnection(appPool, tenantB.id, async (client) => {
      const res = await client.query("SELECT * FROM tenant_configs WHERE key = $1", ["raw-test"]);
      return res.rows;
    });
    expect(resultB).toHaveLength(0);
  });
});

describe("SET LOCAL scoping", () => {
  it("SET LOCAL is scoped to the transaction only", async () => {
    await createTestTenantConfig(adminPool, tenantA.id, userA.id, {
      key: "scoping-test",
      value: "scoped",
    });

    // First transaction sets tenant_id to A
    await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      const result = await tx.tenantConfig.findMany();
      expect(result).toHaveLength(1);
    });

    // Next transaction with different tenant — should NOT leak
    const result = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
      return tx.tenantConfig.findMany();
    });
    expect(result).toHaveLength(0);
  });
});
