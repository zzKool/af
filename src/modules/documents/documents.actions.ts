"use server";

import { z } from "zod/v4";
import { zfd } from "zod-form-data";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { createClock } from "@/kernel/clock/clock";
import { enqueue } from "@/kernel/jobs/queue";
import { MAX_FILE_SIZE_MB } from "@/kernel/nav/constants";
import { extractBlobPath } from "@/kernel/ocr/ocr";
import { createStorageService } from "@/kernel/storage/storage";
import * as documentService from "@/modules/documents/documents";
import { processDocumentJob } from "@/modules/documents/jobs/process-document";

export type { OcrExtractedData, OcrLineItem } from "@/kernel/ocr/ocr";
// Type re-exports for component boundary compliance (components import types from actions, not services)
export type {
  DocumentFilters,
  DocumentListItem,
  DocumentReviewData,
  DocumentSort,
} from "@/modules/documents/documents";

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
    const { file, prefixType } = parsedInput;
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
    );

    if (result.data) {
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

const documentIdSchema = z.object({ documentId: z.string().uuid() });

export const getDocumentForReviewAction = authedAction
  .schema(documentIdSchema)
  .metadata({ name: "getDocumentForReview" })
  .action(async ({ ctx, parsedInput }) => {
    return documentService.getDocumentForReview(
      ctx.tx,
      ctx.callerIdentity,
      getStorage(),
      parsedInput.documentId,
    );
  });

const jsonValue: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
const correctionsSchema = z.object({
  documentId: z.string().uuid(),
  patch: z.record(z.string(), jsonValue),
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
  documentId: z.string().uuid(),
  documentType: z.enum(["expense", "invoice", "contract", "nda", "certificate"]),
});

export const classifyDocumentAction = authedAction
  .schema(classifySchema)
  .metadata({ name: "classifyDocument" })
  .action(async ({ ctx, parsedInput }) => {
    return documentService.classifyDocument(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.documentId,
      parsedInput.documentType,
    );
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

export const refreshSignedUrlAction = authedAction
  .schema(documentIdSchema)
  .metadata({ name: "refreshSignedUrl" })
  .action(async ({ ctx, parsedInput }) => {
    return documentService.refreshSignedUrl(
      ctx.tx,
      ctx.callerIdentity,
      getStorage(),
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
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
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

export const getDocumentFilterOptionsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getDocumentFilterOptions" })
  .action(async ({ ctx }) => {
    return documentService.getDocumentFilterOptions(ctx.tx, ctx.callerIdentity);
  });

export const getDocumentStatsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getDocumentStats" })
  .action(async ({ ctx }) => {
    return documentService.getDocumentStats(ctx.tx, ctx.callerIdentity);
  });

const downloadSchema = z.object({ documentId: z.string().uuid() });

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
  documentId: z.string().uuid(),
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
