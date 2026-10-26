import { describe, expect, it, vi } from "vitest";
import type { DuplicateUploadRef } from "@/modules/documents/documents";
import {
  type BatchItemStatus,
  countOutcomes,
  outcomeOf,
  precheckUpload,
  runUploadBatch,
  type UploadActionResult,
  type UploadOutcome,
} from "@/modules/documents/upload-batch";

const existing: DuplicateUploadRef = {
  id: "doc-0",
  businessKey: "exp_20260301_004",
  fileName: "email.pdf",
  status: "extracted",
  createdAt: new Date("2026-03-01T10:00:00Z"),
  createdBy: "user-1",
  uploadedByName: "Test Owner",
  became: null,
};

const stored = (id: string, key: string, fileName: string): UploadActionResult => ({
  data: { data: { kind: "stored", id, businessKey: key, fileName } },
});

describe("outcomeOf — one action result, one row", () => {
  it("stored → uploaded with its own key", () => {
    expect(outcomeOf(stored("d1", "exp_20261026_001", "a.pdf"), "Upload failed")).toEqual({
      kind: "uploaded",
      doc: { id: "d1", businessKey: "exp_20261026_001", fileName: "a.pdf" },
    });
  });

  it("the same bytes already here → duplicate carrying the existing document", () => {
    expect(outcomeOf({ data: { data: { kind: "duplicate", existing } } }, "Upload failed")).toEqual(
      { kind: "duplicate", existing },
    );
  });

  it("a returned business error → failed with the service's message", () => {
    const error = {
      code: "VALIDATION_ERROR" as const,
      message: "File content does not match expected format",
      retryable: false,
    };
    expect(outcomeOf({ data: { error } }, "Upload failed")).toEqual({
      kind: "failed",
      reason: "File content does not match expected format",
      error,
    });
  });

  it("a server error without a message, or nothing at all → failed with the fallback", () => {
    expect(outcomeOf({ serverError: {} }, "Upload failed")).toEqual({
      kind: "failed",
      reason: "Upload failed",
      error: undefined,
    });
    expect(outcomeOf(undefined, "Upload failed")).toEqual({
      kind: "failed",
      reason: "Upload failed",
    });
  });
});

describe("runUploadBatch — a batch of 3: one uploaded, one duplicate, one failed", () => {
  it("every file gets its own outcome, in order; the failure blocks nothing", async () => {
    const results: Record<string, UploadActionResult> = {
      "a.pdf": stored("d1", "exp_20261026_001", "a.pdf"),
      "b.pdf": { data: { data: { kind: "duplicate", existing } } },
      "c.pdf": {
        data: {
          error: { code: "VALIDATION_ERROR", message: "Not a PDF", retryable: false },
        },
      },
    };
    const uploadOne = vi.fn(async (name: string) => outcomeOf(results[name], "Upload failed"));
    const progress: [number, BatchItemStatus][] = [];

    const outcomes = await runUploadBatch(
      ["a.pdf", "b.pdf", "c.pdf"],
      uploadOne,
      (i, s) => progress.push([i, s]),
      "Upload failed",
    );

    expect(outcomes.map((o) => o.kind)).toEqual(["uploaded", "duplicate", "failed"]);
    expect(outcomes[0]).toMatchObject({ doc: { businessKey: "exp_20261026_001" } });
    expect(outcomes[1]).toMatchObject({ existing: { id: "doc-0" } });
    expect(outcomes[2]).toMatchObject({ reason: "Not a PDF" });
    // one file at a time, each announced before its result
    expect(uploadOne).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([
      [0, "uploading"],
      [0, "uploaded"],
      [1, "uploading"],
      [1, "duplicate"],
      [2, "uploading"],
      [2, "failed"],
    ]);
  });

  it("a throwing upload (the network) fails that file only; the files after it still upload", async () => {
    const uploadOne = vi.fn(async (name: string): Promise<UploadOutcome> => {
      if (name === "b.pdf") throw new Error("Failed to fetch");
      return { kind: "uploaded", doc: { id: name, businessKey: `k-${name}`, fileName: name } };
    });

    const outcomes = await runUploadBatch(
      ["a.pdf", "b.pdf", "c.pdf"],
      uploadOne,
      () => {},
      "Upload failed",
    );

    expect(outcomes).toEqual([
      { kind: "uploaded", doc: { id: "a.pdf", businessKey: "k-a.pdf", fileName: "a.pdf" } },
      { kind: "failed", reason: "Failed to fetch" },
      { kind: "uploaded", doc: { id: "c.pdf", businessKey: "k-c.pdf", fileName: "c.pdf" } },
    ]);
  });

  it("the uploads never overlap: the next starts after the previous one settled", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const uploadOne = async (): Promise<UploadOutcome> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { kind: "failed", reason: "x" };
    };
    await runUploadBatch([1, 2, 3, 4], uploadOne, () => {}, "Upload failed");
    expect(maxInFlight).toBe(1);
  });
});

describe("precheckUpload and countOutcomes", () => {
  it("refuses an oversized or unknown file before anything is posted", () => {
    expect(precheckUpload({ name: "a.PDF", size: 100 }, 10)).toBeNull();
    expect(precheckUpload({ name: "scan.tif", size: 100 }, 10)).toBeNull();
    expect(precheckUpload({ name: "big.pdf", size: 11 * 1024 * 1024 }, 10)).toBe("tooLarge");
    expect(precheckUpload({ name: "a.exe", size: 100 }, 10)).toBe("unsupported");
    expect(precheckUpload({ name: "noext", size: 100 }, 10)).toBe("unsupported");
  });

  it("counts the finished rows by outcome; queued and uploading are not done", () => {
    expect(
      countOutcomes(["uploaded", "duplicate", "failed", "uploading", "queued", "uploaded"]),
    ).toEqual({ done: 4, uploaded: 2, duplicate: 1, failed: 1 });
  });
});
