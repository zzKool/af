import { PrismaClientKnownRequestError } from "@prisma/client-runtime-utils";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { auth } from "@/kernel/auth/auth";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";

// Mock next/headers — provides request headers to auth middleware
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

// Mock the error report — returns a fake reference (F111: a log line, no Sentry)
const { mockReportError } = vi.hoisted(() => ({
  mockReportError: vi.fn(() => "fake-sentry-event-id"),
}));
vi.mock("@/kernel/errors/report-error", () => ({
  reportError: mockReportError,
}));

// Spy on logger.error to verify error handler logging (the request-scoped child logs the crash once
// the logging middleware has run)
const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));
vi.mock("@/kernel/logging/logger", () => ({
  logger: {
    error: mockLoggerError,
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: mockLoggerError,
      debug: vi.fn(),
      child: vi.fn(),
    }),
  },
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
  mockLoggerError.mockClear();
  mockReportError.mockClear();
});

afterAll(async () => {
  await adminPool.end();
});

// Import action clients after mocks are set up
import { headers } from "next/headers";
import { authedAction, ownerAction, publicAction } from "@/kernel/actions/action-client";

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
      { err: expect.any(Error), reference: "fake-sentry-event-id", action: "crashingTest" },
      "Unhandled Server Action error",
    );
  });

  it("handleServerError reports the crash with this request's user, tenant, request id and action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await crashingAction({});
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      userId: owner.callerIdentity.userId,
      tenantId: owner.callerIdentity.tenantId,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      action: "crashingTest",
    });
    expect(result?.serverError?.message).toBe(
      "An unexpected error occurred. Reference: fake-sentry-event-id",
    );
  });

  it("two concurrent crashes each carry their own user and tenant", async () => {
    const a = await createAuthenticatedContext(auth, "owner");
    const b = await createAuthenticatedContext(auth, "owner");
    // each concurrent request reads its own session (whichever reaches the auth middleware first)
    vi.mocked(headers).mockResolvedValueOnce(a.headers).mockResolvedValueOnce(b.headers);
    await Promise.all([crashingAction({}), crashingAction({})]);

    const reported = mockReportError.mock.calls.map(
      (call) =>
        (call as unknown as [unknown, { userId: string; tenantId: string; requestId: string }])[1],
    );
    expect(reported.map((r) => [r.userId, r.tenantId]).sort()).toEqual(
      [
        [a.callerIdentity.userId, a.callerIdentity.tenantId],
        [b.callerIdentity.userId, b.callerIdentity.tenantId],
      ].sort(),
    );
    expect(new Set(reported.map((r) => r.requestId)).size).toBe(2);
  });

  it("handleServerError does NOT call logger.error or reportError for ActionError (business errors)", async () => {
    mockHeaders = new Headers(); // No cookies → UNAUTHORIZED ActionError

    await authedTestAction({});
    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
  });
});
