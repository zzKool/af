import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers — must be before imports
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock getAuthContext
vi.mock("@/kernel/auth/auth", () => ({
  getAuthContext: vi.fn(),
}));

import { authMiddleware } from "@/kernel/actions/auth";
import { getAuthContext } from "@/kernel/auth/auth";

const mockGetAuthContext = vi.mocked(getAuthContext);

function callMiddleware(
  next: (...args: unknown[]) => Promise<unknown> = vi.fn().mockResolvedValue({}),
) {
  return (authMiddleware as (...args: unknown[]) => Promise<unknown>)({
    clientInput: undefined,
    bindArgsClientInputs: [],
    ctx: {},
    metadata: undefined,
    next,
  });
}

describe("authMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UNAUTHORIZED when no session exists", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    await expect(callMiddleware()).rejects.toMatchObject({
      appError: {
        code: "UNAUTHORIZED",
        message: "No active session",
        retryable: false,
      },
    });
  });

  it("passes userId and tenantId to next on valid session", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-123",
      tenantId: "tenant-456",
      role: null,
    });
    const next = vi.fn().mockResolvedValue({});

    await callMiddleware(next);

    expect(next).toHaveBeenCalledWith({
      ctx: {
        userId: "user-123",
        tenantId: "tenant-456",
      },
    });
  });

  it("passes null tenantId when no active organization", async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: "user-123",
      tenantId: null,
      role: null,
    });
    const next = vi.fn().mockResolvedValue({});

    await callMiddleware(next);

    expect(next).toHaveBeenCalledWith({
      ctx: {
        userId: "user-123",
        tenantId: null,
      },
    });
  });
});
