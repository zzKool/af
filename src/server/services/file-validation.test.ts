import { describe, expect, it } from "vitest";
import { sanitizeFileName, validateFile } from "./file-validation";

// Magic bytes for supported formats
const PDF_MAGIC = Buffer.from("%PDF-1.4 test content", "ascii");
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
// TIFF Little Endian
const TIFF_LE_MAGIC = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
// TIFF Big Endian
const TIFF_BE_MAGIC = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);

function makeBuffer(magic: Buffer, totalSize: number): Buffer {
  const buf = Buffer.alloc(totalSize);
  magic.copy(buf);
  return buf;
}

describe("file-validation", () => {
  describe("validateFile", () => {
    it("accepts valid PDF", async () => {
      const result = await validateFile(makeBuffer(PDF_MAGIC, 1024), "test.pdf");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.mime).toBe("application/pdf");
        expect(result.ext).toBe("pdf");
      }
    });

    it("accepts valid JPEG", async () => {
      const result = await validateFile(makeBuffer(JPEG_MAGIC, 1024), "photo.jpg");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.mime).toBe("image/jpeg");
      }
    });

    it("accepts valid PNG", async () => {
      const result = await validateFile(makeBuffer(PNG_MAGIC, 1024), "image.png");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.mime).toBe("image/png");
      }
    });

    it("accepts valid TIFF (little-endian)", async () => {
      const result = await validateFile(makeBuffer(TIFF_LE_MAGIC, 1024), "scan.tiff");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.mime).toBe("image/tiff");
      }
    });

    it("accepts valid TIFF (big-endian)", async () => {
      const result = await validateFile(makeBuffer(TIFF_BE_MAGIC, 1024), "scan.tif");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.mime).toBe("image/tiff");
      }
    });

    it("rejects file with wrong magic bytes", async () => {
      const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
      const result = await validateFile(makeBuffer(garbage, 1024), "fake.pdf");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect(result.error.message).toContain("Unsupported file type");
      }
    });

    it("rejects oversized file (10MB + 1 byte)", async () => {
      const buf = Buffer.alloc(10 * 1024 * 1024 + 1);
      PDF_MAGIC.copy(buf);
      const result = await validateFile(buf, "big.pdf");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect(result.error.message).toContain("10 MB limit");
      }
    });

    it("accepts exactly 10 MB file", async () => {
      const buf = Buffer.alloc(10 * 1024 * 1024);
      PDF_MAGIC.copy(buf);
      const result = await validateFile(buf, "exact.pdf");
      expect(result.valid).toBe(true);
    });

    it("rejects 0-byte file", async () => {
      const result = await validateFile(Buffer.alloc(0), "empty.pdf");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect(result.error.message).toContain("empty");
      }
    });

    it("rejects null buffer", async () => {
      const result = await validateFile(null as unknown as Buffer, "null.pdf");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("extension mismatch: .pdf with JPEG content returns image/jpeg", async () => {
      const result = await validateFile(makeBuffer(JPEG_MAGIC, 1024), "misleading.pdf");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.mime).toBe("image/jpeg");
        expect(result.ext).toBe("jpg");
      }
    });
  });

  describe("sanitizeFileName", () => {
    it("strips path separators", () => {
      expect(sanitizeFileName("../../etc/passwd")).toBe("____etc_passwd");
    });

    it("strips backslash separators", () => {
      expect(sanitizeFileName("C:\\Users\\file.pdf")).toBe("C:_Users_file.pdf");
    });

    it("trims whitespace", () => {
      expect(sanitizeFileName("  file.pdf  ")).toBe("file.pdf");
    });

    it("truncates to 255 chars", () => {
      const longName = `${"a".repeat(300)}.pdf`;
      expect(sanitizeFileName(longName).length).toBe(255);
    });

    it("handles unicode characters", () => {
      const result = sanitizeFileName("faktura_2026_Ö.pdf");
      expect(result).toBe("faktura_2026_Ö.pdf");
    });

    it("handles path traversal attempt", () => {
      const result = sanitizeFileName("../../../secret.pdf");
      expect(result).not.toContain("..");
      expect(result).not.toContain("/");
    });
  });
});
