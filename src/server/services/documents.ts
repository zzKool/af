import { randomUUID } from "node:crypto";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/constants";
import type { TransactionClient } from "@/server/db/tenant-client";
import { logger } from "@/server/logger";
import { toAuditData } from "@/server/services/audit";
import { generateBusinessKey, getDocumentClassification } from "@/server/services/business-key";
import type { Clock } from "@/server/services/clock";
import { validateFile } from "@/server/services/file-validation";
import { extractBlobPath, type OcrExtractedData } from "@/server/services/ocr";
import type { StorageService } from "@/server/services/storage";
import type { AppError } from "@/types/app-error";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

// --- Shared utility: resolve corrections over OCR data ---
// Epic 7 match scoring imports this
export function resolveDocumentData(
  extractedData: OcrExtractedData | null,
  corrections: Partial<OcrExtractedData> | null,
): Partial<OcrExtractedData> {
  if (!extractedData && !corrections) return {};
  if (!extractedData) return corrections ?? {};
  if (!corrections) return extractedData;
  return { ...extractedData, ...corrections }; // shallow merge, arrays fully replaced
}

export type DocumentReviewData = {
  id: string;
  businessKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  prefixType: string;
  documentType: string;
  status: string;
  createdAt: Date;
  signedUrl: string;
  extractedData: OcrExtractedData | null;
  corrections: Partial<OcrExtractedData> | null;
  resolvedData: Partial<OcrExtractedData>;
  quality: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  readOnly: boolean;
};

let containerEnsured = false;

export async function uploadDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  storage: StorageService,
  clock: Clock,
  fileBuffer: Buffer,
  fileName: string,
  prefixType: string,
): Promise<
  ServiceResult<{
    id: string;
    businessKey: string;
    fileName: string;
    status: string;
    documentType: string;
  }>
> {
  // Role check: only owners can upload (fail-closed for future roles)
  if (caller.role !== "owner") {
    return {
      error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false },
    };
  }

  // Validate file (magic bytes + size)
  const validation = await validateFile(fileBuffer, fileName);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const blobId = randomUUID();
  const blobPath = `${caller.tenantId}/${blobId}.${validation.ext}`;

  // Ensure container exists (memoized)
  if (!containerEnsured) {
    await storage.ensureContainer();
    containerEnsured = true;
  }

  // Upload blob with Content-Disposition: attachment (XSS prevention)
  let blobUrl: string;
  try {
    blobUrl = await storage.uploadBlob(blobPath, fileBuffer, validation.mime, {
      contentDisposition: "attachment",
    });
  } catch {
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "File storage temporarily unavailable",
        retryable: true,
      },
    };
  }

  // Generate business key
  const keyResult = await generateBusinessKey(tx, caller, audit, prefixType, clock);
  if (keyResult.error) return { error: keyResult.error };

  // Create DB record
  let record: {
    id: string;
    businessKey: string;
    fileName: string;
    status: string;
    documentType: string;
    blobUrl: string;
    mimeType: string;
    fileSize: number;
    prefixType: string;
    tenantId: string;
    createdBy: string;
    source: string;
  };
  try {
    record = await tx.document.create({
      data: {
        tenantId: caller.tenantId,
        businessKey: keyResult.data.businessKey,
        fileName: validation.sanitizedName,
        blobUrl,
        mimeType: validation.mime,
        fileSize: fileBuffer.length,
        prefixType,
        documentType: keyResult.data.documentType,
        status: "uploaded",
        createdBy: caller.userId,
        source: caller.source,
      },
    });
  } catch (error) {
    // Orphan blob — log warning, blob cleanup is a future concern
    logger.warn({ blobPath, blobUrl, error }, "Orphan blob: DB write failed after blob upload");
    return {
      error: { code: "INTERNAL_ERROR", message: "Document creation failed", retryable: true },
    };
  }

  // Audit trail
  await audit.log({
    action: "create",
    entityType: "document",
    entityId: record.id,
    newData: toAuditData(record),
  });

  return {
    data: {
      id: record.id,
      businessKey: record.businessKey,
      fileName: record.fileName,
      status: record.status,
      documentType: record.documentType,
    },
  };
}

export async function getDocument(
  tx: TransactionClient,
  documentId: string,
): Promise<
  ServiceResult<{
    id: string;
    businessKey: string;
    fileName: string;
    blobUrl: string;
    mimeType: string;
    fileSize: number;
    prefixType: string;
    documentType: string;
    status: string;
    // biome-ignore lint/suspicious/noExplicitAny: Prisma JsonValue type
    ocrData: any;
    createdAt: Date;
  }>
> {
  const doc = await tx.document.findUnique({ where: { id: documentId } });
  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }
  return { data: doc };
}

export async function getRecentDocuments(
  tx: TransactionClient,
  limit = 5,
): Promise<
  ServiceResult<
    {
      id: string;
      businessKey: string;
      fileName: string;
      status: string;
      documentType: string;
      createdAt: Date;
      reviewedAt: Date | null;
    }[]
  >
> {
  const docs = await tx.document.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      businessKey: true,
      fileName: true,
      status: true,
      documentType: true,
      createdAt: true,
      reviewedAt: true,
    },
  });
  return { data: docs };
}

export async function getDocumentOcrData(
  tx: TransactionClient,
  documentId: string,
): Promise<ServiceResult<{ extractedData: OcrExtractedData; quality: string } | null>> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { ocrData: true },
  });
  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }
  if (!doc.ocrData) {
    return { data: null };
  }

  const parsed = doc.ocrData as unknown as { extractedData: OcrExtractedData; quality: string };
  return { data: { extractedData: parsed.extractedData, quality: parsed.quality } };
}

// --- Story 5.3: Document Review & Correction ---

export async function getDocumentForReview(
  tx: TransactionClient,
  caller: CallerIdentity,
  storage: StorageService,
  documentId: string,
): Promise<ServiceResult<DocumentReviewData>> {
  const doc = await tx.document.findUnique({ where: { id: documentId } });
  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }

  // Role check: accountant can view financial only (read-only), owner sees all
  const isAccountant = caller.role === "accountant";
  if (isAccountant && doc.documentType !== "financial") {
    return {
      error: {
        code: "FORBIDDEN",
        message: "Access denied to non-financial documents",
        retryable: false,
      },
    };
  }

  // Parse ocrData JSONB
  let extractedData: OcrExtractedData | null = null;
  let quality: string | null = null;
  if (doc.ocrData) {
    const parsed = doc.ocrData as unknown as {
      extractedData: OcrExtractedData;
      quality: string;
    };
    extractedData = parsed.extractedData ?? null;
    quality = parsed.quality ?? null;
  }

  const corrections = (doc.corrections as Partial<OcrExtractedData>) ?? null;
  const resolvedData = resolveDocumentData(extractedData, corrections);

  // Generate signed URL
  const blobPath = extractBlobPath(doc.blobUrl);
  const signedUrl = await storage.generateSasUrl(blobPath, SIGNED_URL_TTL_SECONDS / 60);

  return {
    data: {
      id: doc.id,
      businessKey: doc.businessKey,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      prefixType: doc.prefixType,
      documentType: doc.documentType,
      status: doc.status,
      createdAt: doc.createdAt,
      signedUrl,
      extractedData,
      corrections,
      resolvedData,
      quality,
      reviewedAt: doc.reviewedAt,
      reviewedBy: doc.reviewedBy,
      readOnly: isAccountant,
    },
  };
}

export async function updateDocumentCorrections(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  documentId: string,
  patch: Record<string, unknown>,
): Promise<ServiceResult<{ corrections: Record<string, unknown> }>> {
  // Owner-only (fail-closed)
  if (caller.role !== "owner") {
    return {
      error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false },
    };
  }

  // Atomic JSONB merge — concurrent-safe, bypasses Prisma read-then-write
  // RLS CRITICAL: tenant_id = current_setting('app.tenant_id') is the safety net
  const result = await tx.$queryRaw<{ corrections: unknown }[]>`
    UPDATE documents
    SET corrections = COALESCE(corrections, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
        updated_at = NOW()
    WHERE id = ${documentId}::uuid
      AND tenant_id = current_setting('app.tenant_id')::uuid
    RETURNING corrections
  `;

  if (result.length === 0) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }

  await audit.log({
    action: "update",
    entityType: "document",
    entityId: documentId,
    newData: { correctionsPatch: patch },
  });

  return { data: { corrections: result[0].corrections as Record<string, unknown> } };
}

export async function classifyDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  documentId: string,
  newPrefixType: string,
): Promise<ServiceResult<{ documentType: string; prefixType: string }>> {
  // Owner-only
  if (caller.role !== "owner") {
    return {
      error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false },
    };
  }

  const newDocumentType = getDocumentClassification(newPrefixType);
  if (!newDocumentType) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Invalid document type: ${newPrefixType}`,
        retryable: false,
      },
    };
  }

  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { status: true, documentType: true, prefixType: true },
  });
  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }

  // Block reclassification on linked status (future-proof for Epic 7)
  if (doc.status === "linked") {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "Cannot reclassify a linked document",
        retryable: false,
      },
    };
  }

  // Update documentType and prefixType — NOT businessKey (immutable)
  await tx.document.update({
    where: { id: documentId },
    data: { documentType: newDocumentType, prefixType: newPrefixType },
  });

  await audit.log({
    action: "update",
    entityType: "document",
    entityId: documentId,
    oldData: { documentType: doc.documentType, prefixType: doc.prefixType },
    newData: { documentType: newDocumentType, prefixType: newPrefixType },
  });

  return { data: { documentType: newDocumentType, prefixType: newPrefixType } };
}

export async function markDocumentReviewed(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  clock: Clock,
  documentId: string,
): Promise<ServiceResult<{ reviewedAt: Date; reviewedBy: string }>> {
  // Owner-only
  if (caller.role !== "owner") {
    return {
      error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false },
    };
  }

  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { id: true },
  });
  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }

  // Idempotent — calling on already-reviewed doc updates reviewedAt/reviewedBy
  const reviewedAt = clock.now();
  await tx.document.update({
    where: { id: documentId },
    data: { reviewedAt, reviewedBy: caller.userId },
  });

  await audit.log({
    action: "update",
    entityType: "document",
    entityId: documentId,
    newData: { reviewedAt: reviewedAt.toISOString(), reviewedBy: caller.userId },
  });

  return { data: { reviewedAt, reviewedBy: caller.userId } };
}

export async function refreshSignedUrl(
  tx: TransactionClient,
  caller: CallerIdentity,
  storage: StorageService,
  documentId: string,
): Promise<ServiceResult<{ signedUrl: string }>> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { blobUrl: true, documentType: true },
  });
  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }

  // Accountant: financial only
  if (caller.role === "accountant" && doc.documentType !== "financial") {
    return {
      error: {
        code: "FORBIDDEN",
        message: "Access denied to non-financial documents",
        retryable: false,
      },
    };
  }

  const blobPath = extractBlobPath(doc.blobUrl);
  const signedUrl = await storage.generateSasUrl(blobPath, SIGNED_URL_TTL_SECONDS / 60);

  return { data: { signedUrl } };
}

/** Reset container memoization (for testing) */
export function _resetContainerEnsured(): void {
  containerEnsured = false;
}
