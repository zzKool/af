import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn(() => "event-1") }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { reportError } from "@/kernel/errors/report-error";

beforeEach(() => captureException.mockClear());

describe("reportError", () => {
  it("attaches the request context to the event itself and returns its id", () => {
    const error = new Error("boom");
    const id = reportError(error, {
      userId: "u-1",
      tenantId: "t-1",
      requestId: "r-1",
      action: "createExpense",
    });
    expect(id).toBe("event-1");
    expect(captureException).toHaveBeenCalledWith(error, {
      user: { id: "u-1" },
      tags: { tenantId: "t-1", requestId: "r-1", action: "createExpense" },
    });
  });

  it("leaves out what the chain had not reached: no user before auth, no null tenant", () => {
    reportError(new Error("early"), { tenantId: null, action: "x" });
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      user: undefined,
      tags: { action: "x" },
    });
  });

  it("tags a job's attempt as a string", () => {
    reportError(new Error("ocr"), { job: "documents.process-document", jobId: "j-1", attempt: 0 });
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      user: undefined,
      tags: { job: "documents.process-document", jobId: "j-1", attempt: "0" },
    });
  });
});
