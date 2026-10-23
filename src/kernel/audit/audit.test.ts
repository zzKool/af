import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { withTenantConnection, withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createTestTenant, createTestUser } from "@/kernel/db/test-fixtures";

// Superuser pool for admin operations (bypasses RLS)
const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

// Non-superuser pool for RLS-enforced operations (app role)
const APP_DATABASE_URL =
  process.env.DATABASE_TEST_URL || "postgresql://af_app:app@localhost:5433/af_test";

let adminPool: Pool;
let appPool: Pool;
let prisma: PrismaClient;

let tenantA: { id: string; name: string };
let tenantB: { id: string; name: string };
let userA: { id: string; email: string; name: string };

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  appPool = new Pool({ connectionString: APP_DATABASE_URL });
  const adapter = new PrismaPg(appPool);
  prisma = new PrismaClient({ adapter });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);

  tenantA = await createTestTenant(adminPool, { name: "Tenant A" });
  tenantB = await createTestTenant(adminPool, { name: "Tenant B" });
  userA = await createTestUser(adminPool, { name: "User A" });
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await prisma.$disconnect();
  await appPool.end();
  await adminPool.end();
});

/**
 * Helper: insert an audit log entry directly via SQL (admin pool, bypasses RLS).
 */
async function insertAuditLog(
  tenantId: string,
  userId: string,
  overrides?: Partial<{
    action: string;
    entityType: string;
    entityId: string;
    source: string;
    oldData: string | null;
    newData: string | null;
  }>,
): Promise<string> {
  const id = randomUUID();
  const client = await adminPool.connect();
  try {
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, source, old_data, new_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
      [
        id,
        tenantId,
        userId,
        overrides?.action ?? "update",
        overrides?.entityType ?? "tenant",
        overrides?.entityId ?? tenantId,
        overrides?.source ?? "web",
        overrides?.oldData ?? null,
        overrides?.newData ?? null,
      ],
    );
  } finally {
    client.release();
  }
  return id;
}

// These tests run as the app role (appPool) within tenant context (SET LOCAL).
// RLS USING clause allows the matching-tenant row to be visible, so RLS alone would
// permit the UPDATE/DELETE. The PostgreSQL RULE is what actually blocks the operation.
// If the RULE were removed, these tests would fail (UPDATE/DELETE would succeed).
describe("audit_logs immutability", () => {
  it("UPDATE on audit_logs has no effect (0 rows changed, original data intact)", async () => {
    const auditId = await insertAuditLog(tenantA.id, userA.id, {
      action: "create",
      entityType: "tenant",
      source: "web",
    });

    // Attempt UPDATE via raw SQL as app user within tenant context
    const result = await withTenantConnection(appPool, tenantA.id, async (client) => {
      const res = await client.query(`UPDATE audit_logs SET action = 'delete' WHERE id = $1`, [
        auditId,
      ]);
      return res.rowCount;
    });

    // PostgreSQL RULE silently drops UPDATE — 0 rows affected
    expect(result).toBe(0);

    // Verify original data intact
    const original = await withTenantConnection(appPool, tenantA.id, async (client) => {
      const res = await client.query(`SELECT action FROM audit_logs WHERE id = $1`, [auditId]);
      return res.rows[0];
    });
    expect(original.action).toBe("create");
  });

  it("DELETE on audit_logs has no effect (0 rows changed, original data intact)", async () => {
    const auditId = await insertAuditLog(tenantA.id, userA.id, {
      action: "update",
      entityType: "tenant",
      source: "web",
    });

    // Attempt DELETE via raw SQL as app user within tenant context
    const result = await withTenantConnection(appPool, tenantA.id, async (client) => {
      const res = await client.query(`DELETE FROM audit_logs WHERE id = $1`, [auditId]);
      return res.rowCount;
    });

    // PostgreSQL RULE silently drops DELETE — 0 rows affected
    expect(result).toBe(0);

    // Verify data still exists
    const stillExists = await withTenantConnection(appPool, tenantA.id, async (client) => {
      const res = await client.query(`SELECT id FROM audit_logs WHERE id = $1`, [auditId]);
      return res.rows;
    });
    expect(stillExists).toHaveLength(1);
  });
});

describe("audit_logs RLS isolation", () => {
  it("Tenant B cannot read Tenant A's audit logs", async () => {
    await insertAuditLog(tenantA.id, userA.id, {
      action: "create",
      entityType: "tenant",
    });

    // Query as Tenant A — should see data
    const resultA = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      return tx.auditLog.findMany();
    });
    expect(resultA).toHaveLength(1);

    // Query as Tenant B — should see nothing
    const resultB = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
      return tx.auditLog.findMany();
    });
    expect(resultB).toHaveLength(0);
  });

  it("INSERT with mismatched tenantId is rejected by WITH CHECK", async () => {
    // Attempt to INSERT audit entry with tenantB's ID while SET LOCAL is tenantA
    await expect(
      withTenantTransaction(prisma, tenantA.id, async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId: tenantB.id, // Mismatch: SET LOCAL has tenantA
            userId: userA.id,
            action: "create",
            entityType: "tenant",
            entityId: tenantB.id,
            source: "web",
          },
        });
      }),
    ).rejects.toThrow();
  });
});

// What createAuditEntry writes into old_data / new_data (F50-g): the write mapper must store exactly what the
// former `as any` casts stored — null and omitted as SQL NULL, a record as its JSON form.
describe("createAuditEntry — the JSON written", () => {
  const caller = (): CallerIdentity => ({
    userId: userA.id,
    tenantId: tenantA.id,
    role: "owner",
    source: "web",
  });

  async function stored(entityId: string) {
    return withTenantConnection(appPool, tenantA.id, async (client) => {
      const res = await client.query(
        `SELECT old_data, new_data, jsonb_typeof(old_data) AS old_type, jsonb_typeof(new_data) AS new_type
           FROM audit_logs WHERE entity_id = $1`,
        [entityId],
      );
      return res.rows[0];
    });
  }

  it("an omitted field is SQL NULL; an explicit null is the JSON null (what the casts always wrote)", async () => {
    const [nulls, omitted] = [randomUUID(), randomUUID()];
    await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      await createAuditEntry(tx, caller(), {
        action: "delete",
        entityType: "partner",
        entityId: nulls,
        oldData: null,
        newData: null,
      });
      await createAuditEntry(tx, caller(), {
        action: "create",
        entityType: "partner",
        entityId: omitted,
      });
    });
    expect(await stored(omitted)).toEqual({
      old_data: null,
      new_data: null,
      old_type: null,
      new_type: null,
    });
    expect(await stored(nulls)).toEqual({
      old_data: null,
      new_data: null,
      old_type: "null",
      new_type: "null",
    });
  });

  it("a record is stored as its JSON form: dates as ISO strings, decimals as strings, undefined dropped", async () => {
    const entityId = randomUUID();
    const oldData: Record<string, unknown> = {
      name: "Acme",
      amount: new Prisma.Decimal("1402.50"),
      issuedAt: new Date("2026-03-21T16:00:00.000Z"),
      types: ["client", "supplier"],
      address: { city: "Neuchâtel", zip: null },
      note: undefined,
      active: true,
      count: 3,
    };
    await withTenantTransaction(prisma, tenantA.id, (tx) =>
      createAuditEntry(tx, caller(), {
        action: "update",
        entityType: "partner",
        entityId,
        oldData,
        newData: { active: false },
      }),
    );
    expect(await stored(entityId)).toEqual({
      old_data: {
        name: "Acme",
        amount: "1402.5",
        issuedAt: "2026-03-21T16:00:00.000Z",
        types: ["client", "supplier"],
        address: { city: "Neuchâtel", zip: null },
        active: true,
        count: 3,
      },
      new_data: { active: false },
      old_type: "object",
      new_type: "object",
    });
  });
});
