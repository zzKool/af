import { Pool } from "pg";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/kernel/auth/auth";
import { cleanupTestData } from "@/kernel/db/test-fixtures";

const silentLogger = pino({ level: "silent" });

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";

let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
});

afterAll(async () => {
  await adminPool.end();
});

// Helper: sign up, sign in, create org, set active, return headers + ids
async function setupOwner() {
  const signUp = await auth.api.signUpEmail({
    body: { email: "owner@test.local", password: "password123", name: "Owner" },
  });

  const response = await auth.api.signInEmail({
    body: { email: "owner@test.local", password: "password123" },
    asResponse: true,
  });
  await response.json();
  const cookies = response.headers.getSetCookie();
  const headers = new Headers();
  headers.set("cookie", cookies.map((c) => c.split(";")[0]).join("; "));

  const org = await auth.api.createOrganization({
    headers,
    body: { name: "Test Org", slug: "test-org" },
  });

  await auth.api.setActiveOrganization({
    headers,
    body: { organizationId: org.id },
  });

  return { userId: signUp.user.id, tenantId: org.id, headers };
}

async function setupAccountant(ownerHeaders: Headers, orgId: string) {
  await auth.api.signUpEmail({
    body: { email: "accountant@test.local", password: "password123", name: "Accountant" },
  });

  const invitation = await auth.api.createInvitation({
    headers: ownerHeaders,
    body: { email: "accountant@test.local", role: "member", organizationId: orgId },
  });

  const response = await auth.api.signInEmail({
    body: { email: "accountant@test.local", password: "password123" },
    asResponse: true,
  });
  const signInData = await response.json();
  const cookies = response.headers.getSetCookie();
  const acctHeaders = new Headers();
  acctHeaders.set("cookie", cookies.map((c) => c.split(";")[0]).join("; "));

  await auth.api.acceptInvitation({
    headers: acctHeaders,
    body: { invitationId: invitation.id },
  });

  await auth.api.setActiveOrganization({
    headers: acctHeaders,
    body: { organizationId: orgId },
  });

  return { userId: signInData.user.id, headers: acctHeaders };
}

// Import tenantMiddleware after setup so mocks are ready
import { tenantMiddleware } from "@/kernel/actions/tenant";

function callTenantMiddleware(
  ctx: { userId: string; tenantId: string | null },
  next: (...args: unknown[]) => Promise<unknown> = vi.fn().mockResolvedValue({}),
) {
  return (tenantMiddleware as (...args: unknown[]) => Promise<unknown>)({
    clientInput: undefined,
    bindArgsClientInputs: [],
    ctx: { ...ctx, log: silentLogger },
    metadata: undefined,
    next,
  });
}

describe("tenantMiddleware", () => {
  it("builds CallerIdentity with owner role for org creator", async () => {
    const { userId, tenantId } = await setupOwner();
    const next = vi.fn().mockResolvedValue({});

    await callTenantMiddleware({ userId, tenantId }, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          callerIdentity: expect.objectContaining({
            userId,
            tenantId,
            role: "owner",
            source: "web",
          }),
        }),
      }),
    );
  });

  it("maps 'member' role to 'accountant'", async () => {
    const owner = await setupOwner();
    const accountant = await setupAccountant(owner.headers, owner.tenantId);
    const next = vi.fn().mockResolvedValue({});

    await callTenantMiddleware({ userId: accountant.userId, tenantId: owner.tenantId }, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          callerIdentity: expect.objectContaining({
            role: "accountant",
          }),
        }),
      }),
    );
  });

  it("throws UNAUTHORIZED when no tenantId", async () => {
    const { userId } = await setupOwner();

    await expect(callTenantMiddleware({ userId, tenantId: null })).rejects.toMatchObject({
      appError: {
        code: "UNAUTHORIZED",
        message: "No active tenant in session",
      },
    });
  });

  it("throws FORBIDDEN when user is not a member", async () => {
    const owner = await setupOwner();
    // Create a second user who is NOT a member of the org
    const signUp = await auth.api.signUpEmail({
      body: { email: "stranger@test.local", password: "password123", name: "Stranger" },
    });

    await expect(
      callTenantMiddleware({ userId: signUp.user.id, tenantId: owner.tenantId }),
    ).rejects.toMatchObject({
      appError: {
        code: "FORBIDDEN",
        message: "User is not a member of the active tenant",
      },
    });
  });

  it("throws FORBIDDEN for stale activeOrganizationId (deleted org)", async () => {
    const { userId } = await setupOwner();
    const fakeOrgId = "00000000-0000-4000-8000-000000000000";

    await expect(callTenantMiddleware({ userId, tenantId: fakeOrgId })).rejects.toMatchObject({
      appError: { code: "FORBIDDEN" },
    });
  });

  it("freezes CallerIdentity (mutation attempt fails)", async () => {
    const { userId, tenantId } = await setupOwner();
    const next = vi.fn().mockImplementation(async ({ ctx }) => {
      // Attempt to mutate the frozen CallerIdentity
      expect(() => {
        (ctx.callerIdentity as Record<string, unknown>).role = "accountant";
      }).toThrow();
      return {};
    });

    await callTenantMiddleware({ userId, tenantId }, next);
    expect(next).toHaveBeenCalled();
  });

  it("provides a transaction client (tx) in context", async () => {
    const { userId, tenantId } = await setupOwner();
    const next = vi.fn().mockImplementation(async ({ ctx }) => {
      // tx should be a Prisma transaction client
      expect(ctx.tx).toBeDefined();
      expect(typeof ctx.tx.tenantConfig.findMany).toBe("function");
      return {};
    });

    await callTenantMiddleware({ userId, tenantId }, next);
    expect(next).toHaveBeenCalled();
  });

  it("provides onCommit in context", async () => {
    const { userId, tenantId } = await setupOwner();
    const next = vi.fn().mockImplementation(async ({ ctx }) => {
      expect(ctx.onCommit).toBeDefined();
      expect(typeof ctx.onCommit).toBe("function");
      return {};
    });

    await callTenantMiddleware({ userId, tenantId }, next);
    expect(next).toHaveBeenCalled();
  });

  it("executes post-commit callbacks after successful transaction", async () => {
    const { userId, tenantId } = await setupOwner();
    const callbackOrder: string[] = [];
    const next = vi.fn().mockImplementation(async ({ ctx }) => {
      ctx.onCommit(async () => {
        callbackOrder.push("cb1");
      });
      ctx.onCommit(async () => {
        callbackOrder.push("cb2");
      });
      return {};
    });

    await callTenantMiddleware({ userId, tenantId }, next);
    expect(callbackOrder).toEqual(["cb1", "cb2"]);
  });

  it("does NOT execute post-commit callbacks if transaction rolls back", async () => {
    const { userId, tenantId } = await setupOwner();
    const callbackExecuted = vi.fn();
    const next = vi.fn().mockImplementation(async ({ ctx }) => {
      ctx.onCommit(async () => {
        callbackExecuted();
      });
      throw new Error("Simulated rollback");
    });

    await expect(callTenantMiddleware({ userId, tenantId }, next)).rejects.toThrow(
      "Simulated rollback",
    );
    expect(callbackExecuted).not.toHaveBeenCalled();
  });

  it("failed callback does not prevent other callbacks from running", async () => {
    const { userId, tenantId } = await setupOwner();
    const callbackOrder: string[] = [];
    const next = vi.fn().mockImplementation(async ({ ctx }) => {
      ctx.onCommit(async () => {
        callbackOrder.push("cb1");
        throw new Error("cb1 failed");
      });
      ctx.onCommit(async () => {
        callbackOrder.push("cb2");
      });
      return {};
    });

    await callTenantMiddleware({ userId, tenantId }, next);
    expect(callbackOrder).toEqual(["cb1", "cb2"]);
  });

  it("failed callback is logged at warn level", async () => {
    const { userId, tenantId } = await setupOwner();
    const { logger } = await import("@/kernel/logging/logger");
    const warnSpy = vi.spyOn(logger, "warn");
    const next = vi.fn().mockImplementation(async ({ ctx }) => {
      ctx.onCommit(async () => {
        throw new Error("side-effect failed");
      });
      return {};
    });

    await callTenantMiddleware({ userId, tenantId }, next);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Post-commit callback failed",
    );
    warnSpy.mockRestore();
  });

  it("concurrent requests get isolated postCommitCallbacks arrays", async () => {
    const { userId, tenantId } = await setupOwner();
    const results: string[][] = [[], []];

    const makeNext = (index: number) =>
      vi.fn().mockImplementation(async ({ ctx }) => {
        ctx.onCommit(async () => {
          results[index].push(`request-${index}`);
        });
        return {};
      });

    await Promise.all([
      callTenantMiddleware({ userId, tenantId }, makeNext(0)),
      callTenantMiddleware({ userId, tenantId }, makeNext(1)),
    ]);

    // Each request should only have its own callback result
    expect(results[0]).toEqual(["request-0"]);
    expect(results[1]).toEqual(["request-1"]);
  });

  it("throws FORBIDDEN for unknown role (e.g. 'admin') via exhaustive match", async () => {
    const { userId, tenantId } = await setupOwner();

    // Directly update the member role to an unexpected value via SQL
    // Better Auth supports "admin" role but our app doesn't map it
    const client = await adminPool.connect();
    try {
      await client.query(
        `UPDATE members SET role = 'admin' WHERE user_id = $1 AND organization_id = $2`,
        [userId, tenantId],
      );
    } finally {
      client.release();
    }

    await expect(callTenantMiddleware({ userId, tenantId })).rejects.toMatchObject({
      appError: {
        code: "FORBIDDEN",
        message: "Unknown role: admin",
      },
    });
  });
});
