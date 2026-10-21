import { beforeEach, describe, expect, it, vi } from "vitest";

const { reportError, logError } = vi.hoisted(() => ({
  reportError: vi.fn(() => "event-9"),
  logError: vi.fn(),
}));
vi.mock("@/kernel/errors/report-error", () => ({ reportError }));
vi.mock("@/kernel/logging/logger", () => ({ logger: { error: logError } }));

import { runReported } from "@/kernel/jobs/run-reported";

beforeEach(() => {
  reportError.mockClear();
  logError.mockClear();
});

describe("runReported", () => {
  it("a failed attempt is reported with the job's context and rethrown so pg-boss retries", async () => {
    const error = new Error("OCR down");
    const handler = vi.fn(async () => {
      throw error;
    });
    await expect(
      runReported(
        "documents.process-document",
        handler,
        { tenantId: "t-1", documentId: "d-1" },
        {
          id: "j-1",
          attempt: 2,
        },
      ),
    ).rejects.toBe(error);
    const context = {
      job: "documents.process-document",
      jobId: "j-1",
      attempt: 2,
      tenantId: "t-1",
    };
    expect(reportError).toHaveBeenCalledWith(error, context);
    expect(logError).toHaveBeenCalledWith(
      { err: error, sentryEventId: "event-9", ...context },
      "jobs: attempt failed",
    );
  });

  it("a payload without a tenant (the rates sync) is reported without one", async () => {
    await expect(
      runReported(
        "rates.ecb-sync",
        async () => Promise.reject(new Error("ECB")),
        {},
        { id: "j-2", attempt: 0 },
      ),
    ).rejects.toThrow("ECB");
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      job: "rates.ecb-sync",
      jobId: "j-2",
      attempt: 0,
      tenantId: undefined,
    });
  });

  it("a successful attempt reports nothing", async () => {
    const handler = vi.fn(async () => {});
    await runReported("x.y", handler, { a: 1 }, { id: "j-3", attempt: 0 });
    expect(handler).toHaveBeenCalledWith({ a: 1 }, { id: "j-3", attempt: 0 });
    expect(reportError).not.toHaveBeenCalled();
  });
});
