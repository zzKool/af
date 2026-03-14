import { fileTypeFromBuffer } from "file-type";
import { MAX_FILE_SIZE_MB } from "@/lib/constants";
import type { AppError } from "@/types/app-error";

const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/tiff"]);

type FileValidationResult =
  | { valid: true; mime: string; ext: string; sanitizedName: string }
  | { valid: false; error: AppError };

export function sanitizeFileName(name: string): string {
  return name.replace(/\0/g, "").replace(/[/\\]/g, "_").replace(/\.\./g, "_").trim().slice(0, 255);
}

export async function validateFile(
  buffer: Buffer,
  fileName: string,
): Promise<FileValidationResult> {
  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      error: { code: "VALIDATION_ERROR", message: "File is empty", retryable: false },
    };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `File exceeds ${MAX_FILE_SIZE_MB} MB limit`,
        retryable: false,
      },
    };
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
    return {
      valid: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Unsupported file type. Accepted: PDF, JPEG, PNG, TIFF",
        retryable: false,
      },
    };
  }

  const sanitizedName = sanitizeFileName(fileName);
  if (!sanitizedName) {
    return {
      valid: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid file name", retryable: false },
    };
  }

  return {
    valid: true,
    mime: detected.mime,
    ext: detected.ext,
    sanitizedName,
  };
}
