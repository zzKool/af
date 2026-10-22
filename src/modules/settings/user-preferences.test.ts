import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import { SUPPORTED_LOCALES } from "@/kernel/nav/constants";
import * as prefsService from "@/modules/settings/user-preferences";

const noopAudit: AuditLogger = { log: async () => {} };

// Mock next/headers
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

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

// Import actions after mocks
import {
  getUserPreferencesAction as getPrefsAction,
  updateUserLocaleAction as updateLocaleAction,
} from "@/modules/settings/user-preferences.actions";

// ─────────────────────────────────────────────────────────────
// User preferences service tests
// ─────────────────────────────────────────────────────────────
describe("user preferences service", () => {
  it("get: returns null locale for new user (no preference set)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.getUserPreferences(tx, owner.callerIdentity);
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.locale).toBeNull();
  });

  it("update: set locale to sv-SE, then read it back", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const updateResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.updateUserLocale(tx, owner.callerIdentity, noopAudit, "sv-SE");
    });
    expect(updateResult.error).toBeUndefined();
    expect(updateResult.data?.updated).toBe(true);

    const getResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.getUserPreferences(tx, owner.callerIdentity);
    });
    expect(getResult.data?.locale).toBe("sv-SE");
  });

  it("update: set then change locale", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.updateUserLocale(tx, owner.callerIdentity, noopAudit, "sv-SE");
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.updateUserLocale(tx, owner.callerIdentity, noopAudit, "en-US");
    });

    const getResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.getUserPreferences(tx, owner.callerIdentity);
    });
    expect(getResult.data?.locale).toBe("en-US");
  });

  it("update: set null to reset to browser locale", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.updateUserLocale(tx, owner.callerIdentity, noopAudit, "sv-SE");
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.updateUserLocale(tx, owner.callerIdentity, noopAudit, null);
    });

    const getResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.getUserPreferences(tx, owner.callerIdentity);
    });
    expect(getResult.data?.locale).toBeNull();
  });

  it("locale validation: reject unsupported locale", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefsService.updateUserLocale(tx, owner.callerIdentity, noopAudit, "xx-YY");
    });

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("locale validation: accept all SUPPORTED_LOCALES", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    for (const locale of SUPPORTED_LOCALES) {
      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return prefsService.updateUserLocale(tx, owner.callerIdentity, noopAudit, locale);
      });
      expect(result.error, `Expected ${locale} to be accepted`).toBeUndefined();
    }
  });

  it("user isolation: user A cannot read user B's preferences", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");

    // User A sets locale
    await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
      return prefsService.updateUserLocale(tx, ownerA.callerIdentity, noopAudit, "sv-SE");
    });

    // User B has no preference set — their query returns null, not user A's locale
    const result = await withTenantTransaction(
      prisma,
      ownerB.callerIdentity.tenantId,
      async (tx) => {
        return prefsService.getUserPreferences(tx, ownerB.callerIdentity);
      },
    );
    expect(result.data?.locale).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Server actions RBAC tests
// ─────────────────────────────────────────────────────────────
describe("user preferences actions RBAC", () => {
  it("any authenticated user can get preferences (authedAction)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await getPrefsAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.locale).toBeNull();
  });

  it("any authenticated user can update locale (authedAction)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await updateLocaleAction({ locale: "fr-FR" });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.updated).toBe(true);
  });

  it("member (accountant) can update locale (authedAction, not owner-only)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await updateLocaleAction({ locale: "en-GB" });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.updated).toBe(true);
  });

  it("unauthenticated cannot get preferences (UNAUTHORIZED)", async () => {
    mockHeaders = new Headers();
    const result = await getPrefsAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
