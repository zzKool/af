import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractBlobPath } from "@/kernel/ocr/ocr";
import { createFsStorageService, fsBlobUrl, resolveInside } from "./fs-storage";
import { resolveStorageDriver } from "./storage";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "af-fs-storage-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kernel/storage — the filesystem driver (F107)", () => {
  it("writes, reads back and deletes a blob under its tenant folder; the URL reads like a Blob URL", async () => {
    const storage = createFsStorageService(root);
    await storage.ensureContainer();
    const path = "11111111-1111-4111-8111-111111111111/receipt.pdf";
    const url = await storage.uploadBlob(path, Buffer.from("%PDF-1.4 x"), "application/pdf", {
      contentDisposition: "attachment",
    });
    expect(url).toBe(`fs://documents/${path}`);
    expect(extractBlobPath(url)).toBe(path); // the OCR job and the file route find the path as before
    expect((await stat(join(root, path))).isFile()).toBe(true);
    expect((await readFile(join(root, path))).toString()).toBe("%PDF-1.4 x");
    expect((await storage.downloadBlob(path)).toString()).toBe("%PDF-1.4 x");
    await storage.deleteBlob(path);
    await expect(stat(join(root, path))).rejects.toThrow();
    await storage.deleteBlob(path); // idempotent, like deleteIfExists
  });

  it("refuses a path that escapes the folder", async () => {
    const storage = createFsStorageService(root);
    await expect(storage.downloadBlob("../outside.txt")).rejects.toThrow(/escapes/);
    await expect(storage.uploadBlob("/etc/passwd", Buffer.alloc(1), "text/plain")).rejects.toThrow(
      /escapes/,
    );
    expect(() => resolveInside(root, "t/x.pdf")).not.toThrow();
    expect(fsBlobUrl("documents", "t/x.pdf")).toBe("fs://documents/t/x.pdf");
  });

  it("has no URLs to sign — the file route serves the bytes (F106)", async () => {
    const storage = createFsStorageService(root);
    await expect(storage.generateSasUrl("t/x.pdf", 5)).rejects.toThrow(/api\/documents/);
    await expect(storage.generateDownloadUrl("t/x.pdf", "x.pdf")).rejects.toThrow(/api\/documents/);
  });

  it("the driver is chosen by STORAGE_DRIVER; blob stays the default; fs needs its folder", () => {
    expect(resolveStorageDriver({})).toEqual({ kind: "blob" });
    expect(resolveStorageDriver({ STORAGE_DRIVER: "blob" })).toEqual({ kind: "blob" });
    expect(resolveStorageDriver({ STORAGE_DRIVER: "fs", STORAGE_DIR: "/data/documents" })).toEqual({
      kind: "fs",
      dir: "/data/documents",
      container: "documents",
    });
    expect(
      resolveStorageDriver({
        STORAGE_DRIVER: " FS ",
        STORAGE_DIR: "/d",
        AZURE_STORAGE_CONTAINER: "docs",
      }),
    ).toEqual({ kind: "fs", dir: "/d", container: "docs" });
    expect(() => resolveStorageDriver({ STORAGE_DRIVER: "fs" })).toThrow(/STORAGE_DIR/);
    expect(() => resolveStorageDriver({ STORAGE_DRIVER: "s3" })).toThrow(/Unknown STORAGE_DRIVER/);
  });
});
