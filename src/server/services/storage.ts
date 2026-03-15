import {
  BlobSASPermissions,
  BlobServiceClient,
  type ContainerClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";

export interface StorageService {
  ensureContainer(): Promise<void>;
  uploadBlob(
    blobPath: string,
    data: Buffer,
    mimeType: string,
    options?: { contentDisposition?: string },
  ): Promise<string>;
  downloadBlob(blobPath: string): Promise<Buffer>;
  deleteBlob(blobPath: string): Promise<void>;
  generateSasUrl(
    blobPath: string,
    expiresInMinutes: number,
    options?: { contentDisposition?: string },
  ): Promise<string>;
  generateDownloadUrl(
    blobPath: string,
    originalFileName: string,
    expiresInMinutes?: number,
  ): Promise<string>;
}

export function createStorageService(
  connectionString?: string,
  containerName?: string,
): StorageService {
  const connStr = connectionString ?? process.env.AZURE_STORAGE_CONNECTION_STRING;
  const container = containerName ?? process.env.AZURE_STORAGE_CONTAINER;

  if (!connStr) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is required for storage service");
  }
  if (!container) {
    throw new Error("AZURE_STORAGE_CONTAINER is required for storage service");
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
  const containerClient: ContainerClient = blobServiceClient.getContainerClient(container);

  // Parse credentials from connection string for SAS generation
  function getSharedKeyCredential(): StorageSharedKeyCredential {
    const accountName = connStr!.match(/AccountName=([^;]+)/)?.[1];
    const accountKey = connStr!.match(/AccountKey=([^;]+)/)?.[1];
    if (!accountName || !accountKey) {
      throw new Error("Cannot parse AccountName/AccountKey from connection string");
    }
    return new StorageSharedKeyCredential(accountName, accountKey);
  }

  return {
    async ensureContainer(): Promise<void> {
      await containerClient.createIfNotExists();
    },

    async uploadBlob(
      blobPath: string,
      data: Buffer,
      mimeType: string,
      options?: { contentDisposition?: string },
    ): Promise<string> {
      const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
      await blockBlobClient.uploadData(data, {
        blobHTTPHeaders: {
          blobContentType: mimeType,
          ...(options?.contentDisposition && {
            blobContentDisposition: options.contentDisposition,
          }),
        },
      });
      return blockBlobClient.url;
    },

    async downloadBlob(blobPath: string): Promise<Buffer> {
      const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
      return blockBlobClient.downloadToBuffer();
    },

    async deleteBlob(blobPath: string): Promise<void> {
      const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
      await blockBlobClient.deleteIfExists();
    },

    async generateSasUrl(
      blobPath: string,
      expiresInMinutes: number,
      options?: { contentDisposition?: string },
    ): Promise<string> {
      const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
      const credential = getSharedKeyCredential();

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: container!,
          blobName: blobPath,
          permissions: BlobSASPermissions.parse("r"),
          expiresOn: new Date(Date.now() + expiresInMinutes * 60 * 1000),
          ...(options?.contentDisposition && {
            contentDisposition: options.contentDisposition,
          }),
        },
        credential,
      ).toString();

      return `${blockBlobClient.url}?${sasToken}`;
    },

    async generateDownloadUrl(
      blobPath: string,
      originalFileName: string,
      expiresInMinutes = 5,
    ): Promise<string> {
      // Sanitize filename for Content-Disposition header safety
      // Remove path traversal, control chars, and characters that break HTTP headers
      const sanitized =
        originalFileName
          .replace(/[/\\]/g, "_") // path separators
          .replace(/[^\x20-\x7E]/g, "_") // non-printable/non-ASCII
          .replace(/["]/g, "_") // double quotes break header
          .trim() || "download";

      const contentDisposition = `attachment; filename="${sanitized}"`;
      return this.generateSasUrl(blobPath, expiresInMinutes, { contentDisposition });
    },
  };
}
