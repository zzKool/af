import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger
vi.mock("@/server/logger", () => ({
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

vi.mock("@/server/db/client", () => ({ prisma: {} }));
vi.mock("@/server/db/tenant-client", () => ({
  withTenantTransaction: vi.fn(async (_prisma, _tenantId, cb) => cb(mockTx)),
}));
vi.mock("@/server/services/audit", () => ({
  createAuditEntry: (...args: unknown[]) => mockAuditLog(...args),
}));

// Mock storage service
const mockDownloadBlob = vi.fn().mockResolvedValue(Buffer.from("fake-pdf"));
const mockGenerateSasUrl = vi.fn().mockResolvedValue("https://blob.url/sas?token=xxx");
vi.mock("@/server/services/storage", () => ({
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
vi.mock("@/server/services/ocr", () => ({
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

// Mock Inngest client
vi.mock("../client", () => ({
  inngest: {
    createFunction: (config: Record<string, unknown>, trigger: unknown, handler: unknown) => ({
      config,
      trigger,
      handler,
      onFailure: config.onFailure,
    }),
  },
}));

// Import after mocks
const { processDocument } = await import("./process-document");

// Helper: create mock step that executes callbacks sequentially
function createMockStep() {
  const stepResults = new Map<string, unknown>();
  return {
    run: async (name: string, fn: () => Promise<unknown>) => {
      if (stepResults.has(name)) return stepResults.get(name);
      const result = await fn();
      stepResults.set(name, result);
      return result;
    },
  };
}

const baseEvent = {
  data: {
    tenantId: "tenant-1",
    userId: "user-1",
    documentId: "doc-1",
  },
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

describe("processDocument handler", () => {
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

    const step = createMockStep();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).handler({ event: baseEvent, step });

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

    const step = createMockStep();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).handler({ event: baseEvent, step });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-1" },
        data: { status: "ocr_failed" },
      }),
    );
  });

  it("OCR failure (retryable): throws error for Inngest retry", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue({
      success: false,
      error: "Timeout",
      retryable: true,
    });

    const step = createMockStep();
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      (processDocument as any).handler({ event: baseEvent, step }),
    ).rejects.toThrow("Timeout");
  });

  it("document not found in step 1 → NonRetriableError", async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    const step = createMockStep();
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      (processDocument as any).handler({ event: baseEvent, step }),
    ).rejects.toThrow(NonRetriableError);
  });

  it("document not found in step 2 → NonRetriableError", async () => {
    mockFindUnique.mockResolvedValueOnce(baseDocument).mockResolvedValueOnce(null);
    mockUpdate.mockResolvedValue({});

    const step = createMockStep();
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      (processDocument as any).handler({ event: baseEvent, step }),
    ).rejects.toThrow(NonRetriableError);
  });

  it("status guard: document not in 'uploaded' state → skip step 1", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" }) // Step 1: already processing
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" }); // Step 2
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(successOcrResult);

    const step = createMockStep();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).handler({ event: baseEvent, step });

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

  it("status guard: document not in 'processing' state in step 2 → skip OCR", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument) // Step 1
      .mockResolvedValueOnce({ ...baseDocument, status: "extracted" }); // Step 2: already extracted
    mockUpdate.mockResolvedValue({});

    const step = createMockStep();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).handler({ event: baseEvent, step });

    // OCR service should not have been called
    expect(mockAnalyzeDocument).not.toHaveBeenCalled();
  });

  it("ocrData JSONB stored with correct structure", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(successOcrResult);

    const step = createMockStep();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).handler({ event: baseEvent, step });

    const extractedCall = mockUpdate.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, Record<string, string>>)?.data?.status === "extracted",
    );
    expect(extractedCall).toBeDefined();
    const ocrData = (extractedCall![0] as Record<string, Record<string, unknown>>).data
      .ocrData as Record<string, unknown>;
    expect(ocrData).toHaveProperty("extractedData");
    expect(ocrData).toHaveProperty("rawResponse");
    expect(ocrData).toHaveProperty("quality");
  });

  it("audit logging for extracted transition", async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseDocument)
      .mockResolvedValueOnce({ ...baseDocument, status: "processing" });
    mockUpdate.mockResolvedValue({});
    mockAnalyzeDocument.mockResolvedValue(successOcrResult);

    const step = createMockStep();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).handler({ event: baseEvent, step });

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

    const step = createMockStep();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).handler({ event: baseEvent, step });

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

    const step = createMockStep();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).handler({ event: baseEvent, step });

    const extractedCall = mockUpdate.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, Record<string, string>>)?.data?.status === "extracted",
    );
    const ocrData = (extractedCall![0] as Record<string, Record<string, unknown>>).data
      .ocrData as Record<string, unknown>;
    expect(ocrData.quality).toBe("low");
  });
});

describe("processDocument onFailure handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks document as ocr_failed when status is processing", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "doc-1", status: "processing" });
    mockUpdate.mockResolvedValue({});

    // CRITICAL: nested event structure
    const failureEvent = {
      data: { event: { data: { tenantId: "tenant-1", userId: "user-1", documentId: "doc-1" } } },
    };
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).onFailure({
      event: failureEvent,
      error: new Error("All retries exhausted"),
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-1" },
        data: { status: "ocr_failed" },
      }),
    );
  });

  it("idempotent: does nothing when document is already ocr_failed", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "doc-1", status: "ocr_failed" });

    const failureEvent = {
      data: { event: { data: { tenantId: "tenant-1", userId: "user-1", documentId: "doc-1" } } },
    };
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).onFailure({
      event: failureEvent,
      error: new Error("All retries exhausted"),
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("idempotent: does nothing when document is already extracted", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "doc-1", status: "extracted" });

    const failureEvent = {
      data: { event: { data: { tenantId: "tenant-1", userId: "user-1", documentId: "doc-1" } } },
    };
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    await (processDocument as any).onFailure({
      event: failureEvent,
      error: new Error("All retries exhausted"),
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
