// The page header on the real database: the user's name, the tenant's name under RLS, the last login, the role —
// and a failed statement inside the tenant transaction reaches the page instead of turning into an empty header.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import { getDashboardData } from "./dashboard";

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;

beforeAll(() => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
});
afterAll(async () => {
  await adminPool.end();
});

async function tenantName(tenantId: string): Promise<string> {
  const r = await adminPool.query("SELECT name FROM tenants WHERE id = $1", [tenantId]);
  return r.rows[0].name;
}

describe("getDashboardData", () => {
  it("reads the user's name, the company and the role", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");

    const header = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      getDashboardData(prisma, tx, caller),
    );

    expect(header.userName).toBe("Test owner");
    expect(header.companyName).toBe(await tenantName(caller.tenantId));
    expect(header.role).toBe(caller.role);
  });

  it("the last login is the session before the current one", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const sessions = await adminPool.query(
      `SELECT created_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC`,
      [caller.userId],
    );

    const header = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      getDashboardData(prisma, tx, caller),
    );

    expect(header.lastLoginAt).toBe(
      sessions.rows.length >= 2 ? new Date(sessions.rows[1].created_at).toISOString() : null,
    );
  });

  it("a first login has no last login", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await adminPool.query(
      `DELETE FROM sessions WHERE user_id = $1
       AND id <> (SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`,
      [caller.userId],
    );

    const header = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      getDashboardData(prisma, tx, caller),
    );

    expect(header.lastLoginAt).toBeNull();
  });

  it("each tenant sees its own company name (RLS)", async () => {
    const a = await createAuthenticatedContext(auth, "owner");
    const b = await createAuthenticatedContext(auth, "owner");

    const header = await withTenantTransaction(prisma, b.callerIdentity.tenantId, (tx) =>
      getDashboardData(prisma, tx, b.callerIdentity),
    );

    expect(header.companyName).toBe(await tenantName(b.callerIdentity.tenantId));
    expect(header.companyName).not.toBe(await tenantName(a.callerIdentity.tenantId));
  });

  it("an aborted tenant transaction reaches the caller, not an empty header", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");

    const read = withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      // an earlier read of the page failed: Postgres aborts the transaction
      await tx.$executeRawUnsafe("SELECT 1/0").catch(() => {});
      return getDashboardData(prisma, tx, caller);
    });

    await expect(read).rejects.toThrow(/aborted/);
  });
});
