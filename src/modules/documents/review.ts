// Review (story 5.3): the single document with its OCR facts and corrections, auto-saved corrections, classify,
// mark reviewed, the preview's signed URL.
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can, documentSubject } from "@/kernel/auth/can";
import type { Clock } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { SIGNED_URL_TTL_SECONDS } from "@/kernel/nav/constants";
import { extractBlobPath, type OcrExtractedData } from "@/kernel/ocr/ocr";
import type { StorageService } from "@/kernel/storage/storage";
import { getDocumentClassification } from "@/modules/documents/business-key";
import { isDocumentLinked } from "./linkable";
import {
  type CorrectionsPatch,
  correctionsPatchSchema,
  type OcrPayload,
  parseCorrections,
  parseOcrPayload,
  resolveDocumentData,
} from "./ocr-payload";

// MUST NOT import from next/* or src/components/*

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
  /** parked on the inbox (specs/documents US4); cleared on restore */
  archivedAt: Date | null;
  readOnly: boolean;
};

/** One document as other modules see it (through `index.ts`): stored columns and the OCR payload read once. */
export type DocumentDto = {
  id: string;
  businessKey: string;
  fileName: string;
  blobUrl: string;
  mimeType: string;
  fileSize: number;
  prefixType: string;
  documentType: string;
  status: string;
  /** `parseOcrPayload` of `ocr_data`: null until the OCR ran; `rawResponse` stays in the column */
  ocrData: OcrPayload | null;
  createdAt: Date;
};

export async function getDocument(
  tx: TransactionClient,
  documentId: string,
): Promise<ServiceResult<DocumentDto>> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      businessKey: true,
      fileName: true,
      blobUrl: true,
      mimeType: true,
      fileSize: true,
      prefixType: true,
      documentType: true,
      status: true,
      ocrData: true,
      createdAt: true,
    },
  });
  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }
  return { data: { ...doc, ocrData: parseOcrPayload(doc.ocrData) } };
}

/**
 * The documents among `ids` that say the buyer pays the VAT (D54): the OCR's reading as corrected on review
 * (`reverseCharge` — the owner can set or clear it). What a flagged document became shows a tag (F91); nothing is
 * computed from it.
 */
export async function reverseChargeDocumentIds(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  // the two JSON paths only, in SQL — `ocr_data` also holds the raw response, too heavy to load per list row.
  // A correction wins when the key is there (true or false), the OCR's reading otherwise — `resolveDocumentData`.
  // RLS CRITICAL: tenant_id = current_setting('app.tenant_id') is the safety net
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM documents
    WHERE id = ANY(${[...ids]}::uuid[])
      AND tenant_id = current_setting('app.tenant_id')::uuid
      AND CASE WHEN corrections ? 'reverseCharge'
               THEN corrections->>'reverseCharge' = 'true'
               ELSE ocr_data->'extractedData'->>'reverseCharge' = 'true' END
  `;
  return new Set(rows.map((r) => r.id));
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
  const payload = parseOcrPayload(doc.ocrData);
  if (!payload?.extractedData || payload.quality === null) {
    return { data: null };
  }
  return { data: { extractedData: payload.extractedData, quality: payload.quality } };
}

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

  const payload = parseOcrPayload(doc.ocrData);
  const extractedData = payload?.extractedData ?? null;
  const quality = payload?.quality ?? null;

  const corrections = parseCorrections(doc.corrections);
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
      archivedAt: doc.archivedAt,
      readOnly: isAccountant,
    },
  };
}

export async function updateDocumentCorrections(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  documentId: string,
  patch: CorrectionsPatch,
): Promise<ServiceResult<{ corrections: Partial<OcrExtractedData> }>> {
  // Owner-only (fail-closed)
  if (!can(caller, "update", "financial_document")) {
    return {
      error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false },
    };
  }

  // Each field against its schema — the action parses too, the service is where the rule lives
  const parsed = correctionsPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return {
      error: { code: "VALIDATION_ERROR", message: "Invalid correction data", retryable: false },
    };
  }
  const patchJson = JSON.stringify(parsed.data);

  // Atomic JSONB merge — concurrent-safe, bypasses Prisma read-then-write
  // RLS CRITICAL: tenant_id = current_setting('app.tenant_id') is the safety net
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
    newData: { correctionsPatch: parsed.data },
  });

  return { data: { corrections: parseCorrections(result[0].corrections) ?? {} } };
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

  // A document that became something or that a bank row justifies keeps its kind (derived from the links)
  if (await isDocumentLinked(tx, documentId)) {
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
