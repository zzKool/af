import { beforeEach, describe, expect, it, vi } from "vitest";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/kernel/logging/logger", () => ({ logger: { error: logError } }));

import { reportError } from "@/kernel/errors/report-error";

beforeEach(() => logError.mockClear());

describe("reportError (F111: a log line with a reference, no Sentry)", () => {
  it("logs the error with its request context and returns a reference the user can quote", () => {
    const error = new Error("boom");
    const id = reportError(error, {
      userId: "u-1",
      tenantId: "t-1",
      requestId: "r-1",
      action: "createExpense",
    });
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(logError).toHaveBeenCalledWith(
      {
        err: error,
        reference: id,
        userId: "u-1",
        tenantId: "t-1",
        requestId: "r-1",
        action: "createExpense",
      },
      "unexpected error",
    );
  });

  it("leaves out what the chain had not reached: no user before auth, no null tenant", () => {
    const id = reportError(new Error("early"), { tenantId: null, action: "x" });
    expect(logError).toHaveBeenCalledWith(
      { err: expect.any(Error), reference: id, action: "x" },
      "unexpected error",
    );
  });

  it("two reports never share a reference", () => {
    const a = reportError(new Error("a"), {
      job: "documents.process-document",
      jobId: "j-1",
      attempt: 0,
    });
    const b = reportError(new Error("b"), {
      job: "documents.process-document",
      jobId: "j-1",
      attempt: 1,
    });
    expect(a).not.toBe(b);
    expect(logError).toHaveBeenLastCalledWith(
      expect.objectContaining({ job: "documents.process-document", jobId: "j-1", attempt: 1 }),
      "unexpected error",
    );
  });
});
