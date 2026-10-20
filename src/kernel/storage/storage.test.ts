import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStorageService, type StorageService } from "@/kernel/storage/storage";

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

describe.skipIf(!connectionString)("StorageService (Azurite)", () => {
  // Unique container per test run for isolation
  const testContainer = `test-${Date.now()}`;
  let storage: StorageService;

  const testTenantId = randomUUID();
  const testBlobId = randomUUID();
  const testBlobPath = `${testTenantId}/${testBlobId}.pdf`;
  const testData = Buffer.from("%PDF-1.4 test content");
  const testMimeType = "application/pdf";

  beforeAll(async () => {
    storage = createStorageService(connectionString, testContainer);
    await storage.ensureContainer();
  });

  afterAll(async () => {
    // Clean up test container
    if (connectionString) {
      const { BlobServiceClient } = await import("@azure/storage-blob");
      const client = BlobServiceClient.fromConnectionString(connectionString);
      const container = client.getContainerClient(testContainer);
      await container.deleteIfExists();
    }
  });

  it("ensureContainer is idempotent", async () => {
    // Calling again should not throw
    await expect(storage.ensureContainer()).resolves.toBeUndefined();
  });

  it("uploads blob and returns URL", async () => {
    const url = await storage.uploadBlob(testBlobPath, testData, testMimeType);
    expect(url).toContain(testBlobPath);
    expect(url).toContain(testContainer);
  });

  it("downloads blob with matching content", async () => {
    const downloaded = await storage.downloadBlob(testBlobPath);
    expect(downloaded).toEqual(testData);
  });

  it("generates a valid SAS URL", async () => {
    const sasUrl = await storage.generateSasUrl(testBlobPath, 5);
    expect(sasUrl).toContain(testBlobPath);
    expect(sasUrl).toContain("sig=");
    expect(sasUrl).toContain("se=");

    // Verify the SAS URL is accessible via HTTP fetch
    const response = await fetch(sasUrl);
    expect(response.ok).toBe(true);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body).toEqual(testData);
  });

  it("generates SAS URL with contentDisposition parameter", async () => {
    const sasUrl = await storage.generateSasUrl(testBlobPath, 5, {
      contentDisposition: 'attachment; filename="test.pdf"',
    });
    expect(sasUrl).toContain(testBlobPath);
    expect(sasUrl).toContain("sig=");
    // Verify Content-Disposition header is present via HTTP fetch (Azurite integration)
    const response = await fetch(sasUrl);
    const cdHeader = response.headers.get("Content-Disposition");
    expect(cdHeader).toContain("attachment");
    expect(cdHeader).toContain("test.pdf");
  });

  it("generateDownloadUrl produces URL with correct Content-Disposition header", async () => {
    const downloadUrl = await storage.generateDownloadUrl(testBlobPath, "invoice-2026.pdf", 5);
    expect(downloadUrl).toContain(testBlobPath);
    const response = await fetch(downloadUrl);
    const cdHeader = response.headers.get("Content-Disposition");
    expect(cdHeader).toContain("attachment");
    expect(cdHeader).toContain("invoice-2026.pdf");
  });

  it("generateDownloadUrl sanitizes filename (no path traversal)", async () => {
    const downloadUrl = await storage.generateDownloadUrl(
      testBlobPath,
      "../../../evil/path.pdf",
      5,
    );
    const response = await fetch(downloadUrl);
    const cdHeader = response.headers.get("Content-Disposition");
    // Path separators should be replaced with underscores
    expect(cdHeader).not.toContain("/");
    expect(cdHeader).not.toContain("..");
  });

  it("deletes blob successfully", async () => {
    await expect(storage.deleteBlob(testBlobPath)).resolves.toBeUndefined();

    // Subsequent download should throw (404)
    await expect(storage.downloadBlob(testBlobPath)).rejects.toThrow();
  });

  it("deleteBlob on non-existent path does not throw (deleteIfExists is idempotent)", async () => {
    const nonExistentPath = `${randomUUID()}/${randomUUID()}.pdf`;
    await expect(storage.deleteBlob(nonExistentPath)).resolves.toBeUndefined();
  });

  it("uploads with tenant-prefixed path structure", async () => {
    const tenantPath = `${randomUUID()}/${randomUUID()}.pdf`;
    const data = Buffer.from("tenant-scoped content");

    const url = await storage.uploadBlob(tenantPath, data, "application/pdf");
    expect(url).toContain(tenantPath);

    const downloaded = await storage.downloadBlob(tenantPath);
    expect(downloaded).toEqual(data);

    // Cleanup
    await storage.deleteBlob(tenantPath);
  });
});

describe("createStorageService validation", () => {
  it("throws when connection string is missing", () => {
    expect(() => createStorageService("", "documents")).toThrow(
      "AZURE_STORAGE_CONNECTION_STRING is required",
    );
  });

  it("throws when container name is missing", () => {
    expect(() =>
      createStorageService(
        "DefaultEndpointsProtocol=http;AccountName=test;AccountKey=dGVzdA==;BlobEndpoint=http://localhost:10000/test;",
        "",
      ),
    ).toThrow("AZURE_STORAGE_CONTAINER is required");
  });
});
