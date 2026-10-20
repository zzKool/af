import { randomUUID } from "node:crypto";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can, documentSubject } from "@/kernel/auth/can";
import type { Clock } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { logger } from "@/kernel/logging/logger";
import { SIGNED_URL_TTL_SECONDS } from "@/kernel/nav/constants";
import { extractBlobPath, type OcrExtractedData } from "@/kernel/ocr/ocr";
import { validateFile } from "@/kernel/storage/file-validation";
import type { StorageService } from "@/kernel/storage/storage";
import { generateBusinessKey, getDocumentClassification } from "@/modules/documents/business-key";

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
  updatedAt: Date;
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
  if (!can(caller, "create", "financial_document")) {
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
  const keyResult = await generateBusinessKey(tx, caller, prefixType, clock);
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

/**
 * Store a document the app itself produced or took in whole (an issued invoice's PDF, a reimbursement statement,
 * an imported bank statement CSV): no OCR, no review — status `generated`, business key given by the producing
 * module (`InvoiceAF_VA26-INV-001.pdf`, `Bank_Plusgirokonto-SEK_2026-07-01_2026-07-31.csv`), kind `financial`.
 * Same blob path convention and audit as an upload; the bytes are already trusted.
 */
const GENERATED_EXTENSION = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/zip": "zip",
} as const;

export async function storeGeneratedDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  storage: StorageService,
  input: {
    bytes: Buffer;
    businessKey: string;
    fileName: string;
    /** a rendered PDF, a bank statement CSV stored by the banking import, or the accountant package's zip */
    mimeType: "application/pdf" | "text/csv" | "application/zip";
    prefixType: string;
  },
): Promise<ServiceResult<{ id: string; businessKey: string; fileName: string }>> {
  const ext = GENERATED_EXTENSION[input.mimeType];
  const blobPath = `${caller.tenantId}/${randomUUID()}.${ext}`;
  if (!containerEnsured) {
    await storage.ensureContainer();
    containerEnsured = true;
  }
  let blobUrl: string;
  try {
    blobUrl = await storage.uploadBlob(blobPath, input.bytes, input.mimeType, {
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
  const record = await tx.document.create({
    data: {
      tenantId: caller.tenantId,
      businessKey: input.businessKey,
      fileName: input.fileName,
      blobUrl,
      mimeType: input.mimeType,
      fileSize: input.bytes.length,
      prefixType: input.prefixType,
      documentType: "financial",
      status: "generated",
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "document",
    entityId: record.id,
    newData: toAuditData(record),
  });
  return { data: { id: record.id, businessKey: record.businessKey, fileName: record.fileName } };
}

/**
 * The final business key of a document that became something (D27): the expense created from a receipt renames it
 * `Ex213-Tr-01_2026-03-10_` (the provisional `exp_20261020_001` goes). Only an uploaded / processed document is
 * renamed — a generated one carries its producer's key from the start. The file name keeps its extension.
 */
export async function assignBusinessKey(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  documentId: string,
  businessKey: string,
): Promise<ServiceResult<{ id: string; businessKey: string; fileName: string }>> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(businessKey)) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Not a business key: "${businessKey}"`,
        retryable: false,
      },
    };
  }
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { id: true, businessKey: true, fileName: true, status: true },
  });
  if (!doc) {
    return { error: { code: "NOT_FOUND", message: "Document not found", retryable: false } };
  }
  if (doc.status === "generated") {
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message: "A generated document keeps the key its producer gave it",
        retryable: false,
      },
    };
  }
  const dot = doc.fileName.lastIndexOf(".");
  const ext = dot > 0 ? doc.fileName.slice(dot) : "";
  const fileName = `${businessKey}${ext}`;
  const updated = await tx.document.update({
    where: { id: documentId },
    data: { businessKey, fileName },
    select: { id: true, businessKey: true, fileName: true },
  });
  await audit.log({
    action: "update",
    entityType: "document",
    entityId: documentId,
    oldData: { businessKey: doc.businessKey, fileName: doc.fileName },
    newData: { businessKey, fileName },
  });
  return { data: updated };
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
  const isAccountant = !can(caller, "read", "relationship_document");
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
      updatedAt: doc.updatedAt,
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
  if (!can(caller, "update", "financial_document")) {
    return {
      error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false },
    };
  }

  // Atomic JSONB merge — concurrent-safe, bypasses Prisma read-then-write
  // RLS CRITICAL: tenant_id = current_setting('app.tenant_id') is the safety net
  let patchJson: string;
  try {
    patchJson = JSON.stringify(patch);
  } catch {
    return {
      error: { code: "VALIDATION_ERROR", message: "Invalid correction data", retryable: false },
    };
  }

  const result = await tx.$queryRaw<{ corrections: unknown }[]>`
    UPDATE documents
    SET corrections = COALESCE(corrections, '{}'::jsonb) || ${patchJson}::jsonb,
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
  if (!can(caller, "update", "financial_document")) {
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
  if (!can(caller, "update", "financial_document")) {
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
  if (!can(caller, "read", documentSubject(doc.documentType))) {
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

// --- Story 5.4: Document Library & Download ---

export interface DocumentFilters {
  status?: string[];
  documentType?: string[];
  prefixType?: string[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface DocumentSort {
  field: "businessKey" | "documentType" | "status" | "createdAt" | "fileSize";
  direction: "asc" | "desc";
}

export type DocumentListItem = {
  id: string;
  businessKey: string;
  fileName: string;
  prefixType: string;
  documentType: string;
  status: string;
  createdAt: Date;
  fileSize: number;
  reviewedAt: Date | null;
  extractedVendor: string | null;
  extractedAmount: number | null;
  extractedCurrency: string | null;
  extractedDate: string | null;
};

export async function getDocuments(
  tx: TransactionClient,
  caller: CallerIdentity,
  filters: DocumentFilters,
  sort: DocumentSort,
  pagination: { page: number; pageSize: number },
): Promise<ServiceResult<{ items: DocumentListItem[]; totalCount: number }>> {
  // Build where clause
  // biome-ignore lint/suspicious/noExplicitAny: Prisma where type is complex
  const where: any = {};

  // Roles without relationship-document access are forced to financial-only regardless of filter input
  if (!can(caller, "read", "relationship_document")) {
    where.documentType = "financial";
  } else if (filters.documentType?.length) {
    where.documentType = { in: filters.documentType };
  }

  if (filters.status?.length) {
    where.status = { in: filters.status };
  }

  if (filters.prefixType?.length) {
    where.prefixType = { in: filters.prefixType };
  }

  if (filters.dateFrom || filters.dateTo) {
    // NOTE: Date filter uses createdAt (upload date), not extractedDate (invoice/transaction date).
    // The "Date" column in the UI shows extractedDate when available, creating a semantic mismatch.
    // Fixing this properly requires an indexed extractedDate column (see story action item).
    where.createdAt = {};
    if (filters.dateFrom) {
      where.createdAt.gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      // Include the full day
      const endDate = new Date(filters.dateTo);
      endDate.setHours(23, 59, 59, 999);
      where.createdAt.lte = endDate;
    }
  }

  if (filters.search) {
    where.OR = [
      { businessKey: { contains: filters.search, mode: "insensitive" } },
      { fileName: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  // Map sort field to Prisma column name
  const orderBy = { [sort.field]: sort.direction };

  const [docs, totalCount] = await Promise.all([
    tx.document.findMany({
      where,
      orderBy,
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        businessKey: true,
        fileName: true,
        prefixType: true,
        documentType: true,
        status: true,
        createdAt: true,
        fileSize: true,
        reviewedAt: true,
        ocrData: true,
        corrections: true,
      },
    }),
    tx.document.count({ where }),
  ]);

  // Resolve extracted data for list display
  const items: DocumentListItem[] = docs.map((doc) => {
    let extractedData: OcrExtractedData | null = null;
    if (doc.ocrData) {
      const parsed = doc.ocrData as unknown as { extractedData: OcrExtractedData };
      extractedData = parsed.extractedData ?? null;
    }
    const corrections = (doc.corrections as Partial<OcrExtractedData>) ?? null;
    const resolved = resolveDocumentData(extractedData, corrections);

    return {
      id: doc.id,
      businessKey: doc.businessKey,
      fileName: doc.fileName,
      prefixType: doc.prefixType,
      documentType: doc.documentType,
      status: doc.status,
      createdAt: doc.createdAt,
      fileSize: doc.fileSize,
      reviewedAt: doc.reviewedAt,
      extractedVendor: resolved.vendorName ?? resolved.merchantName ?? null,
      extractedAmount: resolved.invoiceTotal ?? null,
      extractedCurrency: resolved.currency ?? null,
      extractedDate: resolved.invoiceDate ?? resolved.transactionDate ?? null,
    };
  });

  return { data: { items, totalCount } };
}

export async function getDocumentStats(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<
  ServiceResult<{
    totalCount: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    unreviewed: number;
  }>
> {
  // biome-ignore lint/suspicious/noExplicitAny: Prisma where type is complex
  const where: any = {};
  if (!can(caller, "read", "relationship_document")) {
    where.documentType = "financial";
  }

  const [totalCount, statusGroups, typeGroups, unreviewed] = await Promise.all([
    tx.document.count({ where }),
    tx.document.groupBy({
      by: ["status"],
      where,
      _count: true,
    }),
    tx.document.groupBy({
      by: ["documentType"],
      where,
      _count: true,
    }),
    tx.document.count({
      where: {
        ...where,
        status: { in: ["extracted", "ocr_failed"] },
        reviewedAt: null,
      },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) {
    byStatus[g.status] = g._count;
  }

  const byType: Record<string, number> = {};
  for (const g of typeGroups) {
    byType[g.documentType] = g._count;
  }

  return { data: { totalCount, byStatus, byType, unreviewed } };
}

export async function getDocumentDownloadUrl(
  tx: TransactionClient,
  caller: CallerIdentity,
  storage: StorageService,
  documentId: string,
): Promise<ServiceResult<{ downloadUrl: string }>> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { blobUrl: true, fileName: true, documentType: true },
  });

  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }

  // Accountant: financial documents only
  if (!can(caller, "read", documentSubject(doc.documentType))) {
    return {
      error: {
        code: "FORBIDDEN",
        message: "Access denied to non-financial documents",
        retryable: false,
      },
    };
  }

  const blobPath = extractBlobPath(doc.blobUrl);
  const downloadUrl = await storage.generateDownloadUrl(blobPath, doc.fileName);
  return { data: { downloadUrl } };
}

// --- Story 5.5: Document Deletion & Retention Enforcement ---

export async function deleteDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  documentId: string,
): Promise<ServiceResult<{ businessKey: string; blobUrl: string }>> {
  if (!can(caller, "delete", "financial_document")) {
    return {
      error: { code: "FORBIDDEN", message: "Only owners can delete documents", retryable: false },
    };
  }

  const doc = await tx.document.findUnique({ where: { id: documentId } });
  if (!doc) {
    return { error: { code: "NOT_FOUND", message: "Document not found", retryable: false } };
  }

  if (doc.status === "linked") {
    await audit.log({
      action: "delete",
      entityType: "document",
      entityId: documentId,
      oldData: toAuditData(doc),
      newData: { outcome: "blocked", reason: "linked" },
    });
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message: "Cannot delete — document is linked to a journal entry",
        retryable: false,
      },
    };
  }

  // A generated document (an issued invoice's PDF) is the proof of an immutable record — it lives as long as
  // its source does, and the source is never deleted.
  if (doc.status === "generated") {
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message: `Cannot delete — ${doc.businessKey} was generated from an issued document`,
        retryable: false,
      },
    };
  }

  // Linked documents cannot be hard-deleted: the database trigger documents_block_delete_when_linked
  // (migration 20261020060000_add_links) raises 'document_linked'; translated below.
  // once document-transaction linking is implemented.
  await audit.log({
    action: "delete",
    entityType: "document",
    entityId: documentId,
    oldData: toAuditData(doc),
    newData: { outcome: "deleted" },
  });

  try {
    await tx.document.delete({ where: { id: documentId } });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("document_linked")) {
      await audit.log({
        action: "delete",
        entityType: "document",
        entityId: documentId,
        newData: { outcome: "blocked", reason: "linked" },
      });
      return {
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: "Cannot delete — document is linked",
          retryable: false,
        },
      };
    }
    throw error;
  }

  return { data: { businessKey: doc.businessKey, blobUrl: doc.blobUrl } };
}

/** Reset container memoization (for testing) */
export function _resetContainerEnsured(): void {
  containerEnsured = false;
}

// --- what another module needs to copy a document (the accountant package, FR-002) ---

export type DocumentFile = {
  id: string;
  businessKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: string;
  documentType: string;
};

/** The named documents in one go (missing ids are left out), in id order — plain facts, no blob path. */
export async function documentsByIds(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<DocumentFile[]> {
  if (ids.length === 0) return [];
  const rows = await tx.document.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      businessKey: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      status: true,
      documentType: true,
    },
    orderBy: { id: "asc" },
  });
  return rows;
}

/**
 * Readers for the documents' bytes, through the storage adapter — the package copies receipts and PDFs as stored.
 * Looked up inside the transaction (RLS), downloaded outside it: each reader is a network round trip to call
 * between transactions, never inside one. The blob path never leaves this module. Missing ids are left out.
 */
export async function documentReaders(
  tx: TransactionClient,
  storage: StorageService,
  ids: readonly string[],
): Promise<Map<string, () => Promise<Buffer>>> {
  const out = new Map<string, () => Promise<Buffer>>();
  if (ids.length === 0) return out;
  const docs = await tx.document.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, blobUrl: true },
  });
  for (const doc of docs) {
    const blobPath = extractBlobPath(doc.blobUrl);
    out.set(doc.id, () => storage.downloadBlob(blobPath));
  }
  return out;
}
