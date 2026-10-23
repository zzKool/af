import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

// Mock logger
vi.mock("@/kernel/logging/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock DB / tenant transaction
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockTx = {
  document: { findUnique: mockFindUnique, update: mockUpdate },
};
const mockAuditLog = vi.fn();

vi.mock("@/kernel/db/client", () => ({ prisma: {} }));
vi.mock("@/kernel/db/tenant-client", () => ({
  withTenantTransaction: vi.fn(async (_prisma, _tenantId, cb) => cb(mockTx)),
}));
vi.mock("@/kernel/audit/audit", () => ({
  createAuditEntry: (...args: unknown[]) => mockAuditLog(...args),
}));

// Mock storage service
const mockDownloadBlob = vi.fn().mockResolvedValue(Buffer.from("fake-pdf"));
const mockGenerateSasUrl = vi.fn().mockResolvedValue("https://blob.url/sas?token=xxx");
vi.mock("@/kernel/storage/storage", () => ({
  createStorageService: () => ({
    downloadBlob: mockDownloadBlob,
    generateSasUrl: mockGenerateSasUrl,
    ensureContainer: vi.fn(),
    uploadBlob: vi.fn(),
    deleteBlob: vi.fn(),
  }),
}));

// Mock OCR service
const mockAnalyzeDocument = vi.fn();
vi.mock("@/kernel/ocr/ocr", () => ({
  createOcrService: () => ({
    analyzeDocument: mockAnalyzeDocument,
  }),
  extractBlobPath: (url: string) => {
    const stripped = url.split("?")[0];
    const idx = stripped.indexOf("/documents/");
    if (idx === -1) throw new Error(`Cannot extract blob path from URL: ${url}`);
    return stripped.substring(idx + "/documents/".length);
  },
}));

// Import after mocks
const { processDocumentJob } = await import("@/modules/documents/jobs/process-document");
const { parseOcrPayload } = await import("@/modules/documents/ocr-payload");

const data = { tenantId: "tenant-1", userId: "user-1", documentId: "doc-1" };
const ctx = { id: "job-1", attempt: 0 };
const run = () => processDocumentJob.handler(data, ctx);
const deadLetter = () => {
  if (!processDocumentJob.onDeadLetter) throw new Error("job has no dead-letter handler");
  return processDocumentJob.onDeadLetter(data, ctx);
};

/**
 * What the job wrote to `ocr_data`, through a JSON round trip (what the JSONB column holds) and read back by the
 * services' own parser — the test checks the contract, not the keys of the mock's call (lessons audit 31).
 */
const readBack = () => {
  const call = mockUpdate.mock.calls.find(
    (c: unknown[]) => (c[0] as { data?: { status?: string } })?.data?.status === "extracted",
  );
  if (!call) throw new Error("the job wrote no extracted ocrData");
  const stored: Prisma.JsonValue = JSON.parse(
    JSON.stringify((call[0] as { data: { ocrData: unknown } }).data.ocrData),
  );
  return parseOcrPayload(stored);
};

const baseDocument = {
  id: "doc-1",
  status: "uploaded",
  blobUrl: "http://127.0.0.1:10000/devstoreaccount1/documents/tenant-1/file.pdf",
  mimeType: "application/pdf",
  prefixType: "invoice",
};

const successOcrResult = {
  success: true,
  data: {
    vendorName: "Test AB",
    invoiceTotal: 1000,
    confidence: 0.95,
    modelUsed: "prebuilt-invoice",
    pageCount: 1,
    processingTimeMs: 1200,
  },
  rawResponse: { analyzeResult: { documents: [{ fields: {} }] } },
  quality: "high" as const,
};

describe("processDocument job", () => {
  it("is defined with OCR retries and a dead-letter safety net", () => {
    expect(processDocumentJob.name).toBe("documents.process-document");
    expect(processDocumentJob.options?.retryLimit).toBeGreaterThan(0);
    expect(processDocumentJob.onDeadLetter).toBeDefined();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AZURE_DI_ENDPOINT;
  });

  it("happy path: uploaded → processing → OCR success → extracted", async () => {
    // Step 1: find document in uploaded state
    mockFindUnique
      .mockResolvedValueOnce(baseDocument) // Step 1: findUnique
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" }); // Step 2: findUnique
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(successOcrResult);

    await run();

    // Verify step 1: status updated to processing
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-1" },
        data: { status: "processing" },
      }),
    );

    // Verify step 3: status updated to extracted with ocrData
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-1" },
        data: expect.objectContaining({
          status: "extracted",
          ocrData: expect.objectContaining({
            extractedData: expect.objectContaining({ vendorName: "Test AB" }),
            rawResponse: expect.any(Object),
            quality: "high",
          }),
        }),
      }),
    );
  });

  it("OCR failure (non-retryable): uploaded → processing → ocr_failed", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue({
      success: false,
      error: "Auth failed",
      retryable: false,
    });

    await run();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-1" },
        data: { status: "ocr_failed" },
      }),
    );
  });

  it("OCR failure (retryable): throws so pg-boss retries the job", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue({
      success: false,
      error: "Timeout",
      retryable: true,
    });

    await expect(run()).rejects.toThrow("Timeout");
  });

  it("document not found at claim → completes without retry, touches nothing", async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await run();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAnalyzeDocument).not.toHaveBeenCalled();
  });

  it("document gone before OCR → completes without retry, no OCR call", async () => {
    mockFindUnique.mockResolvedValueOnce(baseDocument).mockResolvedValueOnce(null);
    mockUpdate.mockResolvedValue({});

    await run();

    expect(mockAnalyzeDocument).not.toHaveBeenCalled();
  });

  it("resume: a retry finds the document already 'processing' and goes straight to OCR", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" })
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(successOcrResult);

    await processDocumentJob.handler(data, { id: "job-1", attempt: 2 });

    expect(mockAnalyzeDocument).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1); // only the extracted write
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("extracted");
  });

  it("status guard: document not in 'uploaded' state → no second claim", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" }) // Step 1: already processing
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" }); // Step 2
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(successOcrResult);

    await run();

    // Step 1 should NOT call update (skipped)
    // Step 3 should still save OCR result
    const updateCalls = mockUpdate.mock.calls;
    const step1UpdateCall = updateCalls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>)?.data &&
        (c[0] as Record<string, Record<string, string>>).data.status === "processing",
    );
    expect(step1UpdateCall).toBeUndefined();
  });

  it("status guard: document not in 'processing' state before OCR → skip OCR", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument) // Step 1
      .mockResolvedValueOnce({ ...baseDocument, status: "extracted" }); // Step 2: already extracted
    mockUpdate.mockResolvedValue({});

    await run();

    // OCR service should not have been called
    expect(mockAnalyzeDocument).not.toHaveBeenCalled();
  });

  it("the stored ocrData reads back through parseOcrPayload — the facts and the quality the services see", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(successOcrResult);

    await run();

    expect(readBack()).toEqual({
      extractedData: {
        vendorName: "Test AB",
        invoiceTotal: 1000,
        confidence: 0.95,
        modelUsed: "prebuilt-invoice",
        pageCount: 1,
        processingTimeMs: 1200,
      },
      quality: "high",
    });
  });

  it("audit logging for extracted transition", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(successOcrResult);

    await run();

    // Audit should log the extracted transition
    expect(mockAuditLog).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ tenantId: "tenant-1", userId: "user-1" }),
      expect.objectContaining({
        action: "update",
        entityType: "document",
        entityId: "doc-1",
        newData: expect.objectContaining({ status: "extracted" }),
      }),
    );
  });

  it("audit logging for ocr_failed transition", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue({
      success: false,
      error: "Auth denied",
      retryable: false,
    });

    await run();

    expect(mockAuditLog).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ tenantId: "tenant-1" }),
      expect.objectContaining({
        action: "update",
        entityType: "document",
        newData: expect.objectContaining({ status: "ocr_failed" }),
      }),
    );
  });

  it("quality indicator flows through to stored ocrData", async () => {
    const lowQualityResult = {
      ...successOcrResult,
      quality: "low" as const,
      data: { ...successOcrResult.data, confidence: 0.4 },
    };
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(lowQualityResult);

    await run();

    expect(readBack()).toMatchObject({ quality: "low", extractedData: { confidence: 0.4 } });
  });
});

describe("processDocument dead-letter handler (after the last retry)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks document as ocr_failed when status is processing", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "doc-1", status: "processing" });
    mockUpdate.mockResolvedValue({});

    await deadLetter();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-1" },
        data: { status: "ocr_failed" },
      }),
    );
  });

  it("idempotent: does nothing when document is already ocr_failed", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "doc-1", status: "ocr_failed" });

    await deadLetter();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("idempotent: does nothing when document is already extracted", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "doc-1", status: "extracted" });

    await deadLetter();

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
