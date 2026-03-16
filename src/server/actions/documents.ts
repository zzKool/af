"use server";

import { z } from "zod/v4";
import { zfd } from "zod-form-data";
import { MAX_FILE_SIZE_MB } from "@/lib/constants";
import { inngest } from "@/server/inngest/client";
import { authedAction, ownerAction } from "@/server/middleware/action-client";
import { createClock } from "@/server/services/clock";
import * as documentService from "@/server/services/documents";
import { extractBlobPath } from "@/server/services/ocr";
import { createStorageService } from "@/server/services/storage";

// Type re-exports for component boundary compliance (components import types from actions, not services)
export type {
  DocumentFilters,
  DocumentListItem,
  DocumentReviewData,
  DocumentSort,
} from "@/server/services/documents";
export type { OcrExtractedData, OcrLineItem } from "@/server/services/ocr";

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
      try {
        await inngest.send({
          id: `doc-uploaded-${result.data.id}`,
          name: "document/uploaded",
          data: {
            tenantId: ctx.callerIdentity.tenantId,
            userId: ctx.callerIdentity.userId,
            documentId: result.data.id,
          },
        });
      } catch (err) {
        // Log but don't fail the upload — document is already persisted.
        // Inngest event can be retried manually or via a sweep job.
        const { logger } = await import("@/server/logger");
        logger.warn(
          { documentId: result.data.id, err },
          "Failed to dispatch document/uploaded event",
        );
      }
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

    // TODO: Blob deletion runs inside the tenant middleware transaction (withTenantTransaction
    // wraps the entire handler). AD3 requires this to happen AFTER commit. Acceptable for now
    // since deleteBlob is fast and non-fatal, but a post-commit side-effect pattern should be
    // introduced when more actions need this (same issue exists with inngest.send in upload).
    const { businessKey, blobUrl } = result.data;
    if (blobUrl) {
      try {
        const blobPath = extractBlobPath(blobUrl);
        await getStorage().deleteBlob(blobPath);
      } catch (err) {
        const { logger } = await import("@/server/logger");
        logger.warn(
          { err, documentId },
          "Blob deletion failed after document delete — orphaned blob",
        );
      }
    }
    return { data: { businessKey } };
  });
