import { randomUUID } from "node:crypto";
import type { TransactionClient } from "@/server/db/tenant-client";
import { logger } from "@/server/logger";
import { toAuditData } from "@/server/services/audit";
import { generateBusinessKey } from "@/server/services/business-key";
import type { Clock } from "@/server/services/clock";
import { validateFile } from "@/server/services/file-validation";
import type { StorageService } from "@/server/services/storage";
import type { AppError } from "@/types/app-error";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

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
    },
  });
  return { data: docs };
}

/** Reset container memoization (for testing) */
export function _resetContainerEnsured(): void {
  containerEnsured = false;
}
