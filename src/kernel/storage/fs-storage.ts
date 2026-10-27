// The filesystem storage driver (F107, D61 — audit 2026-10-27 D7): the documents of the company are files in a
// folder on the box (`STORAGE_DIR`, a bind mount or a named volume), backed up with `rsync` or `tar`, read by any
// tool — no emulator in production. The same `StorageService` contract as the Blob driver; the browser never
// needs the store since F106 (the bytes go through `/api/documents/[id]/file`), so there is no URL to sign: a
// document's `blob_url` is `fs://<container>/<blobPath>`, which `extractBlobPath` reads like a Blob URL.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { StorageService } from "./storage";

export const FS_URL_SCHEME = "fs:";

export function fsBlobUrl(container: string, blobPath: string): string {
  return `${FS_URL_SCHEME}//${container}/${blobPath}`;
}

/** `blobPath` is `<tenantId>/<uuid>.<ext>` from the upload — anything that escapes the folder is refused. */
export function resolveInside(root: string, blobPath: string): string {
  const base = resolve(root);
  const target = resolve(base, blobPath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Refused: blob path escapes the storage folder: ${blobPath}`);
  }
  return target;
}

export function createFsStorageService(root: string, container = "documents"): StorageService {
  const unsupported = (what: string) => async (): Promise<never> => {
    throw new Error(
      `${what} is not available on the filesystem driver — documents are served through /api/documents/[id]/file (F106)`,
    );
  };
  return {
    async ensureContainer(): Promise<void> {
      await mkdir(resolve(root), { recursive: true });
    },

    async uploadBlob(blobPath: string, data: Buffer): Promise<string> {
      const target = resolveInside(root, blobPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
      return fsBlobUrl(container, blobPath);
    },

    async downloadBlob(blobPath: string): Promise<Buffer> {
      return readFile(resolveInside(root, blobPath));
    },

    async deleteBlob(blobPath: string): Promise<void> {
      await rm(resolveInside(root, blobPath), { force: true });
    },

    generateSasUrl: unsupported("A signed URL"),
    generateDownloadUrl: unsupported("A download URL"),
  };
}
