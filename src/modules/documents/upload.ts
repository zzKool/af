// Upload (specs/documents US1–US2): validated bytes → blob → business key → `documents` row, the content-hash
// duplicate card; documents the app produces itself (`generated`); the final key a document gets when it becomes
// something (D27).
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { Clock } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { logger } from "@/kernel/logging/logger";
import { validateFile } from "@/kernel/storage/file-validation";
import type { StorageService } from "@/kernel/storage/storage";
import { generateBusinessKey } from "@/modules/documents/business-key";
import { createdFromTargets } from "@/modules/linking";

// MUST NOT import from next/* or src/components/*

let containerEnsured = false;

/** The document already holding the uploaded bytes (specs/documents US2): shown on the upload card. */
export type DuplicateUploadRef = {
  id: string;
  businessKey: string;
  fileName: string;
  status: string;
  createdAt: Date;
  createdBy: string;
  /** the uploader's name — the user table sits outside the tenant transaction, so the action fills it in */
  uploadedByName: string | null;
  /** what the existing document became (`created_from`), with the entity's key, when it did (FR-009) */
  became: { type: "expense" | "supplier_invoice"; id: string; label: string | null } | null;
};

export type UploadResult =
  | {
      kind: "stored";
      id: string;
      businessKey: string;
      fileName: string;
      status: string;
      documentType: string;
    }
  | { kind: "duplicate"; existing: DuplicateUploadRef };

/**
 * The uploader's name for the duplicate card (FR-009). `users` belongs to auth, not to a tenant, so it is read
 * with the plain client after the tenant transaction — never inside it. Null when the user is gone.
 */
export async function uploaderName(db: PrismaClient, userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

export function contentHashOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function uploadDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  storage: StorageService,
  clock: Clock,
  fileBuffer: Buffer,
  fileName: string,
  prefixType: string,
  options: { force?: boolean } = {},
): Promise<ServiceResult<UploadResult>> {
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

  // The same bytes already stored (D32): nothing is written, the caller shows the card — unless the owner
  // said "upload anyway", which stores a second copy and is audited as such. A hard-deleted document is gone.
  const contentHash = contentHashOf(fileBuffer);
  const existing = await tx.document.findFirst({
    where: { tenantId: caller.tenantId, contentHash },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      businessKey: true,
      fileName: true,
      status: true,
      createdAt: true,
      createdBy: true,
    },
  });
  if (existing && !options.force) {
    const became = (await createdFromTargets(tx, [existing.id], { labels: true })).get(existing.id);
    return {
      data: {
        kind: "duplicate",
        existing: {
          ...existing,
          uploadedByName: null,
          became:
            became?.type === "expense" || became?.type === "supplier_invoice"
              ? { type: became.type, id: became.id, label: became.label }
              : null,
        },
      },
    };
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
        contentHash,
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

  // Audit trail (a knowing duplicate names the document it copies)
  await audit.log({
    action: "create",
    entityType: "document",
    entityId: record.id,
    newData: {
      ...toAuditData(record),
      ...(existing ? { knowingDuplicateOf: existing.id } : {}),
    },
  });

  return {
    data: {
      kind: "stored",
      id: record.id,
      businessKey: record.businessKey,
      fileName: record.fileName,
      status: record.status,
      documentType: record.documentType,
    },
  };
}

/** Other documents of the tenant holding the same bytes as `documentId` (the hash strategy of the duplicate check). */
export async function sameContentDocumentIds(
  tx: TransactionClient,
  documentId: string,
): Promise<string[]> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { tenantId: true, contentHash: true },
  });
  if (!doc?.contentHash) return [];
  const twins = await tx.document.findMany({
    where: { tenantId: doc.tenantId, contentHash: doc.contentHash, id: { not: documentId } },
    select: { id: true },
  });
  return twins.map((t) => t.id);
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
      contentHash: contentHashOf(input.bytes),
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

/** Reset container memoization (for testing) */
export function _resetContainerEnsured(): void {
  containerEnsured = false;
}
