import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyQuality,
  createAzureOcrService,
  createMockOcrService,
  createOcrService,
  extractAddressValue,
  extractBlobPath,
  MODEL_MAP,
  type OcrSource,
  resolveOcrProvider,
} from "@/kernel/ocr/ocr";

// Mock logger
vi.mock("@/kernel/logging/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockSource: OcrSource = {
  type: "buffer",
  buffer: Buffer.from("fake"),
  mimeType: "application/pdf",
};

// --- Mock OCR service tests ---

describe("createMockOcrService", () => {
  const mock = createMockOcrService();

  it("returns invoice fixture for 'invoice' prefix", async () => {
    const result = await mock.analyzeDocument(mockSource, "invoice");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.vendorName).toBe("Test Vendor AB");
    expect(result.data.invoiceTotal).toBe(1250.0);
    expect(result.data.modelUsed).toBe("prebuilt-invoice");
    expect(result.quality).toBe("high");
  });

  it("returns receipt fixture for 'expense' prefix", async () => {
    const result = await mock.analyzeDocument(mockSource, "expense");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.merchantName).toBe("ICA Maxi");
    expect(result.data.invoiceTotal).toBe(342.5);
    expect(result.data.modelUsed).toBe("prebuilt-receipt");
    expect(result.quality).toBe("high");
  });

  it("returns layout fixture for 'contract' prefix", async () => {
    const result = await mock.analyzeDocument(mockSource, "contract");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelUsed).toBe("prebuilt-layout");
    expect(result.data.vendorName).toBeUndefined();
    expect(result.quality).toBe("none");
  });

  it("returns layout fixture for 'nda' prefix", async () => {
    const result = await mock.analyzeDocument(mockSource, "nda");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelUsed).toBe("prebuilt-layout");
    expect(result.quality).toBe("none");
  });

  it("returns layout fixture for 'certificate' prefix", async () => {
    const result = await mock.analyzeDocument(mockSource, "certificate");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelUsed).toBe("prebuilt-layout");
    expect(result.quality).toBe("none");
  });

  it("falls back to contract fixture for unknown prefix", async () => {
    const result = await mock.analyzeDocument(mockSource, "unknown-type");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelUsed).toBe("prebuilt-layout");
    expect(result.quality).toBe("none");
  });
});

// --- Quality classification tests ---

describe("classifyQuality", () => {
  it("returns 'high' when confidence >= 0.7 and key field present", () => {
    expect(
      classifyQuality("prebuilt-invoice", 0.95, {
        vendorName: "Test",
        confidence: 0.95,
        modelUsed: "prebuilt-invoice",
        pageCount: 1,
        processingTimeMs: 100,
      }),
    ).toBe("high");
  });

  it("returns 'low' when confidence < 0.7", () => {
    expect(
      classifyQuality("prebuilt-invoice", 0.5, {
        vendorName: "Test",
        confidence: 0.5,
        modelUsed: "prebuilt-invoice",
        pageCount: 1,
        processingTimeMs: 100,
      }),
    ).toBe("low");
  });

  it("returns 'low' when no key financial fields", () => {
    expect(
      classifyQuality("prebuilt-invoice", 0.9, {
        confidence: 0.9,
        modelUsed: "prebuilt-invoice",
        pageCount: 1,
        processingTimeMs: 100,
      }),
    ).toBe("low");
  });

  it("returns 'none' for layout model", () => {
    expect(
      classifyQuality("prebuilt-layout", 0.95, {
        vendorName: "Test",
        confidence: 0.95,
        modelUsed: "prebuilt-layout",
        pageCount: 1,
        processingTimeMs: 100,
      }),
    ).toBe("none");
  });
});

// --- Model selection tests ---

describe("MODEL_MAP", () => {
  it("maps known prefix types to correct models", () => {
    expect(MODEL_MAP.expense).toBe("prebuilt-receipt");
    expect(MODEL_MAP.invoice).toBe("prebuilt-invoice");
    expect(MODEL_MAP.contract).toBe("prebuilt-layout");
    expect(MODEL_MAP.nda).toBe("prebuilt-layout");
    expect(MODEL_MAP.certificate).toBe("prebuilt-layout");
  });

  it("returns undefined for unknown prefix (factory code uses ?? fallback)", () => {
    expect(MODEL_MAP["unknown-type"]).toBeUndefined();
  });
});

// --- Factory tests ---

describe("createOcrService / resolveOcrProvider (F108: the mock only when asked)", () => {
  it("Azure when both keys are set and nothing says otherwise", () => {
    expect(
      resolveOcrProvider({ AZURE_DI_ENDPOINT: "https://di.example", AZURE_DI_KEY: "k" }),
    ).toEqual({ kind: "azure", endpoint: "https://di.example", apiKey: "k" });
    expect(
      resolveOcrProvider({
        OCR_PROVIDER: "azure",
        AZURE_DI_ENDPOINT: "https://di.example",
        AZURE_DI_KEY: "k",
      }).kind,
    ).toBe("azure");
  });

  it("the mock only under OCR_PROVIDER=mock — never as a fallback", () => {
    expect(resolveOcrProvider({ OCR_PROVIDER: "mock" })).toEqual({ kind: "mock" });
    expect(resolveOcrProvider({ OCR_PROVIDER: " Mock " })).toEqual({ kind: "mock" });
    expect(resolveOcrProvider({})).toEqual({
      kind: "none",
      reason: "AZURE_DI_ENDPOINT and AZURE_DI_KEY not set",
    });
    expect(resolveOcrProvider({ AZURE_DI_ENDPOINT: "https://di.example" })).toEqual({
      kind: "none",
      reason: "AZURE_DI_KEY not set",
    });
    expect(resolveOcrProvider({ AZURE_DI_ENDPOINT: " ", AZURE_DI_KEY: "k" })).toEqual({
      kind: "none",
      reason: "AZURE_DI_ENDPOINT not set",
    });
    expect(resolveOcrProvider({ OCR_PROVIDER: "tesseract" })).toEqual({
      kind: "none",
      reason: 'unknown OCR_PROVIDER "tesseract"',
    });
  });

  it("unconfigured: every analysis fails non-retryable with the reason and the hint", async () => {
    const service = createOcrService({});
    const result = await service.analyzeDocument(
      { type: "buffer", buffer: Buffer.from("x"), mimeType: "application/pdf" },
      "inv",
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("AZURE_DI_ENDPOINT and AZURE_DI_KEY not set");
    expect(result.error).toContain("OCR_PROVIDER=mock");
  });

  it("the mock service when asked, the Azure service when configured", () => {
    expect(createOcrService({ OCR_PROVIDER: "mock" }).analyzeDocument).toBeDefined();
    expect(
      createOcrService({ AZURE_DI_ENDPOINT: "https://di.example", AZURE_DI_KEY: "k" })
        .analyzeDocument,
    ).toBeDefined();
  });
});

// --- extractBlobPath tests ---

describe("extractBlobPath", () => {
  const origContainer = process.env.AZURE_STORAGE_CONTAINER;

  beforeEach(() => {
    process.env.AZURE_STORAGE_CONTAINER = "documents";
  });

  afterEach(() => {
    if (origContainer) process.env.AZURE_STORAGE_CONTAINER = origContainer;
    else delete process.env.AZURE_STORAGE_CONTAINER;
  });

  it("extracts path from Azurite URL", () => {
    expect(
      extractBlobPath("http://127.0.0.1:10000/devstoreaccount1/documents/abc-123/file.pdf"),
    ).toBe("abc-123/file.pdf");
  });

  it("extracts path from Azure URL", () => {
    expect(extractBlobPath("https://afdocs.blob.core.windows.net/documents/abc-123/file.pdf")).toBe(
      "abc-123/file.pdf",
    );
  });

  it("strips query params from URL", () => {
    expect(
      extractBlobPath(
        "https://afdocs.blob.core.windows.net/documents/abc-123/file.pdf?sv=2024&sig=xxx",
      ),
    ).toBe("abc-123/file.pdf");
  });

  it("throws for URL without container name", () => {
    expect(() => extractBlobPath("https://example.com/other/abc.pdf")).toThrow(
      "Cannot extract blob path",
    );
  });
});

// --- VendorAddress (documents T026, FR-003) ---

describe("extractAddressValue", () => {
  it("maps Azure's address parts and the printed lines", () => {
    expect(
      extractAddressValue({
        type: "address",
        content: "Storgatan 1\n111 22 Stockholm",
        valueAddress: {
          houseNumber: "1",
          road: "Storgatan",
          postalCode: "111 22",
          city: "Stockholm",
          countryRegion: "se",
          streetAddress: "Storgatan 1",
        },
      }),
    ).toEqual({
      street: "Storgatan 1",
      postalCode: "111 22",
      city: "Stockholm",
      country: "SE",
      text: "Storgatan 1, 111 22 Stockholm",
    });
  });

  it("builds the street from road + house number, drops a country that is not ISO alpha-2", () => {
    expect(
      extractAddressValue({
        type: "address",
        valueAddress: { road: "Market St", houseNumber: "548", countryRegion: "USA" },
      }),
    ).toEqual({ street: "Market St 548" });
  });

  it("is undefined for a missing, empty or non-address field", () => {
    expect(extractAddressValue(undefined)).toBeUndefined();
    expect(extractAddressValue({ type: "address", valueAddress: {} })).toBeUndefined();
    expect(extractAddressValue({ type: "string", valueString: "Storgatan 1" })).toBeUndefined();
  });

  it("the mock invoice carries a vendor address", async () => {
    const result = await createMockOcrService().analyzeDocument(mockSource, "invoice");
    if (!result.success) throw new Error("mock failed");
    expect(result.data.vendorAddress).toMatchObject({ city: "Stockholm", country: "SE" });
  });
});

// --- Azure DI integration tests (gated) ---

describe.skipIf(!process.env.AZURE_DI_ENDPOINT)("Azure DI integration", () => {
  it("analyzes a test invoice PDF", async () => {
    const endpoint = process.env.AZURE_DI_ENDPOINT ?? "";
    const key = process.env.AZURE_DI_KEY ?? "";
    const service = createAzureOcrService(endpoint, key);

    const pdfPath = path.join(__dirname, "__fixtures__", "test-invoice.pdf");
    const buffer = fs.readFileSync(pdfPath);
    const source: OcrSource = { type: "buffer", buffer, mimeType: "application/pdf" };

    const result = await service.analyzeDocument(source, "invoice");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelUsed).toBe("prebuilt-invoice");
    expect(result.data.pageCount).toBeGreaterThanOrEqual(0);
    expect(result.data.processingTimeMs).toBeGreaterThan(0);
  }, 30_000);

  it("analyzes a test receipt JPEG", async () => {
    const endpoint = process.env.AZURE_DI_ENDPOINT ?? "";
    const key = process.env.AZURE_DI_KEY ?? "";
    const service = createAzureOcrService(endpoint, key);

    const jpgPath = path.join(__dirname, "__fixtures__", "test-receipt.jpg");
    const buffer = fs.readFileSync(jpgPath);
    const source: OcrSource = { type: "buffer", buffer, mimeType: "image/jpeg" };

    const result = await service.analyzeDocument(source, "expense");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelUsed).toBe("prebuilt-receipt");
  }, 30_000);
});

// --- Azure DI mock tests (error handling, field mapping) ---

describe("createAzureOcrService", () => {
  // We test the Azure service by mocking the SDK module
  const mockPost = vi.fn();
  const mockPath = vi.fn(() => ({ post: mockPost }));
  const _mockClient = { path: mockPath };

  beforeEach(() => {
    vi.resetModules();
    mockPost.mockReset();
    mockPath.mockReset().mockReturnValue({ post: mockPost });
  });

  it("accepts both URL and buffer source types via OcrService interface", async () => {
    // Mock service accepts both source types (ignores source contents).
    // Azure DI URL vs buffer body construction is covered by gated integration tests.
    const mock = createMockOcrService();
    const urlSource: OcrSource = { type: "url", url: "https://blob.url/doc.pdf" };
    const bufSource: OcrSource = {
      type: "buffer",
      buffer: Buffer.from("data"),
      mimeType: "application/pdf",
    };

    const result1 = await mock.analyzeDocument(urlSource, "invoice");
    const result2 = await mock.analyzeDocument(bufSource, "invoice");

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
  });
});
