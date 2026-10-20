import { describe, expect, it, vi } from "vitest";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const { mockChild } = vi.hoisted(() => ({
  mockChild: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }),
}));

vi.mock("@sentry/nextjs", () => ({
  setTag: vi.fn(),
}));

vi.mock("@/kernel/logging/logger", () => ({
  logger: {
    child: mockChild,
  },
}));

import { loggingMiddleware } from "@/kernel/actions/logging";

function callLoggingMiddleware(
  ctx: { userId: string; tenantId: string | null },
  next: (...args: unknown[]) => Promise<unknown> = vi.fn().mockResolvedValue({}),
  metadata: { name: string } = { name: "testAction" },
) {
  return (loggingMiddleware as (...args: unknown[]) => Promise<unknown>)({
    clientInput: undefined,
    bindArgsClientInputs: [],
    ctx,
    metadata,
    next,
  });
}

describe("loggingMiddleware", () => {
  it("injects log into context with userId, tenantId, requestId bindings", async () => {
    const next = vi.fn().mockResolvedValue({});

    await callLoggingMiddleware({ userId: "user-1", tenantId: "tenant-1" }, next);

    expect(mockChild).toHaveBeenCalledWith({
      userId: "user-1",
      tenantId: "tenant-1",
      requestId: expect.stringMatching(UUID_V4_REGEX),
    });

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          userId: "user-1",
          tenantId: "tenant-1",
          log: expect.any(Object),
        }),
      }),
    );
  });

  it("generates a valid UUID v4 requestId", async () => {
    const next = vi.fn().mockResolvedValue({});

    await callLoggingMiddleware({ userId: "user-1", tenantId: "tenant-1" }, next);

    const childArgs = mockChild.mock.calls[mockChild.mock.calls.length - 1][0];
    expect(childArgs.requestId).toMatch(UUID_V4_REGEX);
  });

  it("handles null tenantId in context bindings", async () => {
    const next = vi.fn().mockResolvedValue({});

    await callLoggingMiddleware({ userId: "user-1", tenantId: null }, next);

    expect(mockChild).toHaveBeenCalledWith({
      userId: "user-1",
      tenantId: null,
      requestId: expect.stringMatching(UUID_V4_REGEX),
    });

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          userId: "user-1",
          tenantId: null,
          log: expect.any(Object),
        }),
      }),
    );
  });

  it("logs action entry at info level", async () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    mockChild.mockReturnValueOnce(mockLog);

    await callLoggingMiddleware(
      { userId: "user-1", tenantId: "tenant-1" },
      vi.fn().mockResolvedValue({}),
    );

    expect(mockLog.info).toHaveBeenCalledWith({ action: "testAction" }, "Action invoked");
  });

  it("logs action completion with duration and metadata name", async () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    mockChild.mockReturnValueOnce(mockLog);

    await callLoggingMiddleware(
      { userId: "user-1", tenantId: "tenant-1" },
      vi.fn().mockResolvedValue({}),
      { name: "createPartner" },
    );

    expect(mockLog.info).toHaveBeenCalledTimes(2);
    expect(mockLog.info).toHaveBeenCalledWith(
      { action: "createPartner", durationMs: expect.any(Number) },
      "Action completed",
    );
  });
});
