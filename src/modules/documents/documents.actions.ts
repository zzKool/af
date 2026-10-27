"use server";

import { z } from "zod/v4";
import { zfd } from "zod-form-data";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { enqueue } from "@/kernel/jobs/queue";
import { listQuerySchema } from "@/kernel/list-query/schema";
import { MAX_FILE_SIZE_MB } from "@/kernel/nav/constants";
import { extractBlobPath } from "@/kernel/ocr/ocr";
import { createStorageService } from "@/kernel/storage/storage";
import * as documentService from "@/modules/documents/documents";
import { processDocumentJob } from "@/modules/documents/jobs/process-document";
import { DOCUMENT_COLUMN_KEYS, type DocumentColumn } from "@/modules/documents/library-columns";
import { correctionsPatchSchema } from "@/modules/documents/ocr-payload";
import {
  distinctDocumentValues,
  documentDateHierarchy,
  listInbox,
  toInboxData,
} from "@/modules/documents/queries";

export type { OcrExtractedData, OcrLineItem } from "@/kernel/ocr/ocr";
// Type re-exports for component boundary compliance (components import types from actions, not services)
export type {
  DocumentFilters,
  DocumentListItem,
  DocumentReviewData,
  DocumentSort,
} from "@/modules/documents/documents";

import { isoDate, uuid } from "@/kernel/validation/scalars";

const uploadSchema = zfd.formData({
  file: zfd.file(
    z
      .instanceof(File)
      .refine(
        (f) => f.size <= MAX_FILE_SIZE_MB * 1024 * 1024,
        `File exceeds ${MAX_FILE_SIZE_MB} MB limit`,
      ),
  ),
  prefixType: zfd.text(z.string().min(1)),
  /** "Upload anyway" on the duplicate card (owner): store a second copy of bytes the tenant already holds */
  force: zfd.text(z.enum(["true", "false"]).optional()),
});

let _storage: ReturnType<typeof createStorageService> | null = null;
function getStorage() {
  if (!_storage) _storage = createStorageService();
  return _storage;
}
const clock = createClock();

export const uploadDocumentAction = authedAction
  .schema(uploadSchema)
  .metadata({ name: "uploadDocument" })
  .action(async ({ ctx, parsedInput }) => {
    const { file, prefixType, force } = parsedInput;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const result = await documentService.uploadDocument(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      getStorage(),
      clock,
      fileBuffer,
      file.name,
      prefixType,
      { force: force === "true" },
    );

    // FR-009: the card names the uploader; `users` is read outside the tenant transaction
    if (result.data?.kind === "duplicate") {
      const existing = result.data.existing;
      return {
        data: {
          kind: "duplicate" as const,
          existing: {
            ...existing,
            uploadedByName: await documentService.uploaderName(prisma, existing.createdBy),
          },
        },
      };
    }

    if (result.data?.kind === "stored") {
      const documentId = result.data.id;
      const { tenantId, userId } = ctx.callerIdentity;
      ctx.onCommit(async () => {
        await enqueue(
          processDocumentJob,
          { tenantId, userId, documentId },
          { singletonKey: documentId },
        );
      });
    }

    return result;
  });

export const getRecentDocumentsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getRecentDocuments" })
  .action(async ({ ctx }) => {
    return documentService.getRecentDocuments(ctx.tx);
  });

// --- Story 5.3: Document Review & Correction ---

const documentIdSchema = z.object({ documentId: uuid });

export const getDocumentForReviewAction = authedAction
  .schema(documentIdSchema)
  .metadata({ name: "getDocumentForReview" })
  .action(async ({ ctx, parsedInput }) => {
    return documentService.getDocumentForReview(ctx.tx, ctx.callerIdentity, parsedInput.documentId);
  });

const correctionsSchema = z.object({
  documentId: uuid,
  patch: correctionsPatchSchema,
});

export const updateDocumentCorrectionsAction = authedAction
  .schema(correctionsSchema)
  .metadata({ name: "updateDocumentCorrections" })
  .action(async ({ ctx, parsedInput }) => {
    return documentService.updateDocumentCorrections(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.documentId,
      parsedInput.patch,
    );
  });

const classifySchema = z.object({
  documentId: uuid,
  documentType: z.enum(["expense", "invoice", "contract", "nda", "certificate"]),
});

export const classifyDocumentAction = authedAction
  .schema(classifySchema)
  .metadata({ name: "classifyDocument" })
  .action(async ({ ctx, parsedInput }) => {
    const result = await documentService.classifyDocument(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.documentId,
      parsedInput.documentType,
    );
    // the type drives the reading (D52): the new kind's model reads it again, queued after the commit
    if (result.data?.reread) {
      const { tenantId, userId } = ctx.callerIdentity;
      const documentId = parsedInput.documentId;
      ctx.onCommit(async () => {
        await enqueue(
          processDocumentJob,
          { tenantId, userId, documentId },
          { singletonKey: documentId },
        );
      });
    }
    return result;
  });

export const markDocumentReviewedAction = authedAction
  .schema(documentIdSchema)
  .metadata({ name: "markDocumentReviewed" })
  .action(async ({ ctx, parsedInput }) => {
    return documentService.markDocumentReviewed(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock,
      parsedInput.documentId,
    );
  });

// --- Story 5.4: Document Library & Download ---

const documentsQuerySchema = z.object({
  filters: z
    .object({
      status: z.array(z.string()).optional(),
      documentType: z.array(z.string()).optional(),
      prefixType: z.array(z.string()).optional(),
      dateFrom: isoDate.optional(),
      dateTo: isoDate.optional(),
      search: z.string().max(200).optional(),
    })
    .optional(),
  sort: z
    .object({
      field: z.enum(["businessKey", "documentType", "status", "createdAt", "fileSize"]),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
});

export const getDocumentsAction = authedAction
  .schema(documentsQuerySchema)
  .metadata({ name: "getDocuments" })
  .action(async ({ ctx, parsedInput }) => {
    return documentService.getDocuments(
      ctx.tx,
      ctx.callerIdentity,
      parsedInput.filters ?? {},
      parsedInput.sort ?? { field: "createdAt", direction: "desc" },
      { page: parsedInput.page, pageSize: parsedInput.pageSize },
    );
  });

export const getDocumentStatsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getDocumentStats" })
  .action(async ({ ctx }) => {
    return documentService.getDocumentStats(ctx.tx, ctx.callerIdentity);
  });

const downloadSchema = z.object({ documentId: uuid });

export const getDocumentDownloadUrlAction = authedAction
  .schema(downloadSchema)
  .metadata({ name: "getDocumentDownloadUrl" })
  .action(async ({ ctx, parsedInput }) => {
    return documentService.getDocumentDownloadUrl(
      ctx.tx,
      ctx.callerIdentity,
      getStorage(),
      parsedInput.documentId,
    );
  });

// --- Story 5.5: Document Deletion & Retention Enforcement ---

const deleteDocumentSchema = z.object({
  documentId: uuid,
});

export const deleteDocumentAction = ownerAction
  .schema(deleteDocumentSchema)
  .metadata({ name: "deleteDocument" })
  .action(async ({ parsedInput, ctx }) => {
    const { documentId } = parsedInput;
    const result = await documentService.deleteDocument(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      documentId,
    );
    if (result.error) return { error: result.error };

    const { businessKey, blobUrl } = result.data;
    if (blobUrl) {
      ctx.onCommit(async () => {
        const blobPath = extractBlobPath(blobUrl);
        await getStorage().deleteBlob(blobPath);
      });
    }
    return { data: { businessKey } };
  });

// --- the library's header filters (D20; the role rule is the read model's) ---

const documentColumnSchema = z.enum(DOCUMENT_COLUMN_KEYS as [DocumentColumn, ...DocumentColumn[]]);

/** Distinct values with counts for a header filter (Excel semantics: the other filters apply). */
export const distinctDocumentValuesAction = authedAction
  .schema(z.object({ column: documentColumnSchema, query: listQuerySchema }))
  .metadata({ name: "distinctDocumentValues" })
  .action(async ({ ctx, parsedInput }) => ({
    data: await distinctDocumentValues(
      ctx.tx,
      ctx.callerIdentity,
      parsedInput.column,
      parsedInput.query,
    ),
  }));

/** Year → month → day counts for a date column's header filter. */
export const documentDateHierarchyAction = authedAction
  .schema(z.object({ column: documentColumnSchema, query: listQuerySchema }))
  .metadata({ name: "documentDateHierarchy" })
  .action(async ({ ctx, parsedInput }) => ({
    data: await documentDateHierarchy(
      ctx.tx,
      ctx.callerIdentity,
      parsedInput.column,
      parsedInput.query,
    ),
  }));

// --- the inbox (specs/documents US4) ---

const idsSchema = z.object({
  ids: z.array(uuid).min(1).max(documentService.ARCHIVE_BULK_MAX),
});

/** Park inbox rows (owner); per-id outcomes for the undo stack. */
export const archiveDocumentsAction = ownerAction
  .schema(idsSchema)
  .metadata({ name: "archiveDocuments" })
  .action(async ({ ctx, parsedInput }) =>
    documentService.archiveDocuments(ctx.tx, ctx.callerIdentity, ctx.audit, clock, parsedInput.ids),
  );

/** Bring parked rows back (owner). */
export const unarchiveDocumentsAction = ownerAction
  .schema(idsSchema)
  .metadata({ name: "unarchiveDocuments" })
  .action(async ({ ctx, parsedInput }) =>
    documentService.unarchiveDocuments(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.ids),
  );

/** Run the OCR again on a failed / stuck document (owner); `force` for a completed one. The job is queued after the commit. */
export const runOcrAction = ownerAction
  .schema(z.object({ documentId: uuid, force: z.boolean().optional() }))
  .metadata({ name: "runOcr" })
  .action(async ({ ctx, parsedInput }) => {
    const result = await documentService.prepareOcrRerun(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock,
      parsedInput.documentId,
      { force: parsedInput.force },
    );
    if (result.data) {
      const { tenantId, userId } = ctx.callerIdentity;
      const documentId = parsedInput.documentId;
      ctx.onCommit(async () => {
        await enqueue(
          processDocumentJob,
          { tenantId, userId, documentId },
          { singletonKey: documentId },
        );
      });
    }
    return result;
  });

/** The inbox rows of a tab + the counts (anyone who may read documents) — the page's refresh. */
export const listInboxAction = authedAction
  .schema(
    z.object({
      tab: z.enum(["all", "pending", "ready", "duplicates", "archived"]).optional(),
      q: z.string().max(100).optional(),
    }),
  )
  .metadata({ name: "listInbox" })
  .action(async ({ ctx, parsedInput }) => ({
    data: toInboxData(await listInbox(ctx.tx, ctx.callerIdentity, parsedInput)),
  }));
