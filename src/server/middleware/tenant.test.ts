import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth";
import { cleanupTestData } from "@/server/db/test-fixtures";

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
import { tenantMiddleware } from "./tenant";

function callTenantMiddleware(
  ctx: { userId: string; tenantId: string | null },
  next: (...args: unknown[]) => Promise<unknown> = vi.fn().mockResolvedValue({}),
) {
  return (tenantMiddleware as (...args: unknown[]) => Promise<unknown>)({
    clientInput: undefined,
    bindArgsClientInputs: [],
    ctx,
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
});
