import { PrismaClientKnownRequestError } from "@prisma/client-runtime-utils";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { auth } from "@/server/auth";
import { cleanupTestData, createAuthenticatedContext } from "@/server/db/test-fixtures";
import { resetRateLimit } from "./rate-limit";

// Mock next/headers — provides request headers to auth middleware
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

// Mock Sentry — returns a fake event ID
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(() => "fake-sentry-event-id"),
  setUser: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn(),
}));

// Spy on logger.error to verify error handler logging
const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));
vi.mock("@/server/logger", () => ({
  logger: {
    error: mockLoggerError,
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    }),
  },
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
  mockLoggerError.mockClear();
});

afterAll(async () => {
  await adminPool.end();
});

// Import action clients after mocks are set up
import { authedAction, ownerAction, publicAction } from "./action-client";

// Create test actions for each chain
const publicTestAction = publicAction
  .schema(z.object({}))
  .metadata({ name: "publicTest" })
  .action(async () => {
    return { ok: true };
  });

const authedTestAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "authedTest" })
  .action(async ({ ctx }) => {
    return { ok: true, role: ctx.callerIdentity.role };
  });

const ownerTestAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "ownerTest" })
  .action(async ({ ctx }) => {
    return { ok: true, role: ctx.callerIdentity.role };
  });

// Test action that throws an unhandled error (for handleServerError tests)
const crashingAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "crashingTest" })
  .action(async () => {
    throw new Error("Unexpected crash");
  });

const prismaCrashingAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "prismaCrashingTest" })
  .action(async () => {
    throw new PrismaClientKnownRequestError("Connection refused", {
      code: "P1001",
      clientVersion: "7.0.0",
    });
  });

describe("action-client integration", () => {
  it("full chain: authenticated owner → action executes successfully", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await ownerTestAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.ok).toBe(true);
    expect(result?.data?.role).toBe("owner");
  });

  it("full chain: accountant via ownerAction → FORBIDDEN", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const accountant = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
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
    const owner = await createAuthenticatedContext(auth, "owner");
    const accountant = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = accountant.headers;

    const result = await authedTestAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.ok).toBe(true);
    expect(result?.data?.role).toBe("accountant");
  });

  it("handleServerError returns INTERNAL_ERROR with retryable: false for generic errors", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await crashingAction({});
    expect(result?.serverError).toMatchObject({
      code: "INTERNAL_ERROR",
      retryable: false,
    });
    expect(result?.serverError?.message).toMatch(/^An unexpected error occurred\. Reference: /);
  });

  it("handleServerError returns INTERNAL_ERROR with retryable: true for Prisma errors", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await prismaCrashingAction({});
    expect(result?.serverError).toMatchObject({
      code: "INTERNAL_ERROR",
      retryable: true,
    });
    expect(result?.serverError?.message).toMatch(/^An unexpected error occurred\. Reference: /);
  });

  it("handleServerError calls logger.error for unexpected errors", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    await crashingAction({});
    expect(mockLoggerError).toHaveBeenCalledWith(
      { err: expect.any(Error), sentryEventId: expect.any(String) },
      "Unhandled Server Action error",
    );
  });

  it("handleServerError does NOT call logger.error for ActionError (business errors)", async () => {
    mockHeaders = new Headers(); // No cookies → UNAUTHORIZED ActionError

    await authedTestAction({});
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});
