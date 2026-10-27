// Library (story 5.4): the filtered list, counts, recent documents, the download URL; and the plain facts + byte
// readers another module needs to copy documents (the accountant package).
import type { Prisma } from "@/generated/prisma/client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can, documentSubject } from "@/kernel/auth/can";
import { addDays } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { extractBlobPath } from "@/kernel/ocr/ocr";
import type { StorageService } from "@/kernel/storage/storage";
import { createdFromTargets } from "@/modules/linking";
import { documentFileUrl } from "./file";
import { parseCorrections, parseOcrPayload, resolveDocumentData } from "./ocr-payload";
import { type DocumentState, documentState } from "./state-family";

// MUST NOT import from next/* or src/components/*

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
  const where: Prisma.DocumentWhereInput = {};

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
    const createdAt: Prisma.DateTimeFilter = {};
    // A day is the calendar day of `kernel/clock/calendar` (UTC midnight to UTC midnight), whatever the process's
    // time zone — `setHours` on the UTC instant cut the last hours of `dateTo` under a local TZ (lessons audit 28).
    if (filters.dateFrom) {
      createdAt.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
    }
    if (filters.dateTo) {
      // the whole day: up to the next day's start
      createdAt.lt = new Date(`${addDays(filters.dateTo, 1)}T00:00:00.000Z`);
    }
    where.createdAt = createdAt;
  }

  if (filters.search) {
    where.OR = [
      { businessKey: { contains: filters.search, mode: "insensitive" } },
      { fileName: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  // Map sort field to Prisma column name
  const orderBy = { [sort.field]: sort.direction };

  const docs = await tx.document.findMany({
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
  });
  const totalCount = await tx.document.count({ where });

  // Resolve extracted data for list display
  const items: DocumentListItem[] = docs.map((doc) => {
    const extractedData = parseOcrPayload(doc.ocrData)?.extractedData ?? null;
    const corrections = parseCorrections(doc.corrections);
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
  }>
> {
  const where: Prisma.DocumentWhereInput = can(caller, "read", "relationship_document")
    ? {}
    : { documentType: "financial" };

  // "to review" is the inbox's number (`inboxTotals`), not a second count here
  const totalCount = await tx.document.count({ where });
  const statusGroups = await tx.document.groupBy({
    by: ["status"],
    where,
    _count: true,
  });
  const typeGroups = await tx.document.groupBy({
    by: ["documentType"],
    where,
    _count: true,
  });

  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) {
    byStatus[g.status] = g._count;
  }

  const byType: Record<string, number> = {};
  for (const g of typeGroups) {
    byType[g.documentType] = g._count;
  }

  return { data: { totalCount, byStatus, byType } };
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

  // F106: the authenticated route, `download=1` — the browser never sees a storage URL
  return { data: { downloadUrl: documentFileUrl(documentId, { download: true }) } };
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

// --- what another module needs to copy a document (the accountant package, FR-002) ---

export type DocumentFile = {
  id: string;
  businessKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: string;
  documentType: string;
  /** the derived state (`documentState`): the inbox's while it waits, else *filed* / *generated* — nothing stored */
  documentState: DocumentState;
};

/**
 * The named documents in one go (missing ids are left out), in id order — plain facts, no blob path, and each
 * one's derived state on the inbox's facts (D34: a `created_from` target is out of the inbox).
 */
export async function documentsByIds(
  tx: TransactionClient,
  ids: readonly string[],
  options: { now?: Date } = {},
): Promise<DocumentFile[]> {
  if (ids.length === 0) return [];
  const now = options.now ?? new Date();
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
      archivedAt: true,
      reviewedAt: true,
      updatedAt: true,
    },
    orderBy: { id: "asc" },
  });
  const became = await createdFromTargets(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map(({ archivedAt, reviewedAt, updatedAt, ...r }) => ({
    ...r,
    documentState: documentState(
      { status: r.status, archivedAt, reviewedAt, updatedAt, became: became.has(r.id) },
      now,
    ),
  }));
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
