import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { auth } from "@/server/auth";
import { cleanupTestData } from "@/server/db/test-fixtures";
import { resetRateLimit } from "./rate-limit";

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

async function setupOwnerWithHeaders() {
  await auth.api.signUpEmail({
    body: { email: "owner@test.local", password: "password123", name: "Owner" },
  });

  const response = await auth.api.signInEmail({
    body: { email: "owner@test.local", password: "password123" },
    asResponse: true,
  });
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

  return { headers, orgId: org.id };
}

async function setupAccountantWithHeaders(ownerHeaders: Headers, orgId: string) {
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

  return { headers: acctHeaders };
}

// Import action clients after mocks are set up
import { authedAction, ownerAction, publicAction } from "./action-client";

// Create test actions for each chain
const publicTestAction = publicAction.schema(z.object({})).action(async () => {
  return { ok: true };
});

const authedTestAction = authedAction.schema(z.object({})).action(async ({ ctx }) => {
  return { ok: true, role: ctx.callerIdentity.role };
});

const ownerTestAction = ownerAction.schema(z.object({})).action(async ({ ctx }) => {
  return { ok: true, role: ctx.callerIdentity.role };
});

describe("action-client integration", () => {
  it("full chain: authenticated owner → action executes successfully", async () => {
    const { headers } = await setupOwnerWithHeaders();
    mockHeaders = headers;

    const result = await ownerTestAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.ok).toBe(true);
    expect(result?.data?.role).toBe("owner");
  });

  it("full chain: accountant via ownerAction → FORBIDDEN", async () => {
    const owner = await setupOwnerWithHeaders();
    const accountant = await setupAccountantWithHeaders(owner.headers, owner.orgId);
    mockHeaders = accountant.headers;

    const result = await ownerTestAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({
      code: "FORBIDDEN",
      message: "Requires owner role",
    });
  });

  it("full chain: unauthenticated → UNAUTHORIZED", async () => {
    mockHeaders = new Headers(); // No cookies

    const result = await authedTestAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("publicAction works without auth cookies", async () => {
    mockHeaders = new Headers(); // No cookies

    const result = await publicTestAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.ok).toBe(true);
  });

  it("authedAction allows accountant for read operations", async () => {
    const owner = await setupOwnerWithHeaders();
    const accountant = await setupAccountantWithHeaders(owner.headers, owner.orgId);
    mockHeaders = accountant.headers;

    const result = await authedTestAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.ok).toBe(true);
    expect(result?.data?.role).toBe("accountant");
  });
});
