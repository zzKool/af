import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/server/db/test-fixtures";
import { resetRateLimit } from "@/server/middleware/rate-limit";
import type { AuditLogger } from "@/types/audit";
import * as settingsService from "./settings";

/** No-op audit logger for tests that don't care about audit */
const noopAudit: AuditLogger = { log: async () => {} };

// Mock next/headers — provides request headers to auth middleware
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";

let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  mockHeaders = new Headers();
});

afterAll(async () => {
  await adminPool.end();
});

// Import actions after mocks are set up
import {
  getTenantProfile,
  listTenantMembers,
  updateTenantProfile,
} from "@/server/actions/settings";

describe("settings service", () => {
  it("getTenantProfile returns tenant data", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        return settingsService.getTenantProfile(tx, owner.callerIdentity);
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data?.currency).toBe("SEK");
    expect(typeof result.data?.name).toBe("string");
  });

  it("updateTenantProfile updates and returns new data", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        return settingsService.updateTenantProfile(tx, owner.callerIdentity, noopAudit, {
          name: "Updated Company",
          orgNumber: "123456-7890",
          address: "New Street 1",
        });
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      name: "Updated Company",
      orgNumber: "123456-7890",
      address: "New Street 1",
      currency: "SEK",
    });
  });

  it("updateTenantProfile syncs Organization name", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return settingsService.updateTenantProfile(tx, owner.callerIdentity, noopAudit, {
        name: "Synced Name",
      });
    });

    // Verify Organization was also updated
    const org = await prisma.organization.findUnique({
      where: { id: owner.callerIdentity.tenantId },
    });
    expect(org?.name).toBe("Synced Name");
  });

  it("getTenantProfile returns NOT_FOUND for non-existent tenant", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const fakeCaller = {
      ...owner.callerIdentity,
      tenantId: "00000000-0000-0000-0000-000000000000",
    };

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        // Use the real tx but with a fake tenantId in caller
        return settingsService.getTenantProfile(tx, fakeCaller);
      },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("afterCreateOrganization hook", () => {
  it("creates Tenant row when Organization is created", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Verify Tenant row exists (auto-created by hook) — must read within RLS context
    const tenant = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return tx.tenant.findUnique({ where: { id: tenantId } });
    });
    expect(tenant).not.toBeNull();
    expect(tenant?.id).toBe(tenantId);
    expect(tenant?.currency).toBe("SEK");
  });

  it("Tenant row has correct default currency (SEK)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const tenant = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return tx.tenant.findUnique({ where: { id: tenantId } });
    });
    expect(tenant?.currency).toBe("SEK");
  });

  it("upsert is idempotent — creating org with existing tenant does not crash", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Manually upsert again via RLS-scoped transaction (simulates hook firing twice)
    await expect(
      withTenantTransaction(prisma, tenantId, async (tx) => {
        return tx.tenant.upsert({
          where: { id: tenantId },
          update: { name: "Re-upserted" },
          create: { id: tenantId, name: "Re-upserted" },
        });
      }),
    ).resolves.toBeDefined();
  });
});

describe("settings actions", () => {
  it("owner can get profile via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await getTenantProfile({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data).toBeDefined();
    expect(result?.data?.data?.currency).toBe("SEK");
  });

  it("owner can update profile via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await updateTenantProfile({ name: "Action Updated" });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.name).toBe("Action Updated");
  });

  it("accountant cannot access settings → FORBIDDEN", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const accountant = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = accountant.headers;

    const result = await getTenantProfile({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated → UNAUTHORIZED", async () => {
    mockHeaders = new Headers();

    const result = await getTenantProfile({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("owner can list tenant members", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await listTenantMembers({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data).toBeDefined();
    expect(Array.isArray(result?.data?.data)).toBe(true);
    expect(result?.data?.data?.length).toBeGreaterThanOrEqual(1);
  });
});
