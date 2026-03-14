"use server";

import { z } from "zod/v4";
import { zfd } from "zod-form-data";
import { MAX_FILE_SIZE_MB } from "@/lib/constants";
import { inngest } from "@/server/inngest/client";
import { authedAction } from "@/server/middleware/action-client";
import { createClock } from "@/server/services/clock";
import * as documentService from "@/server/services/documents";
import { createStorageService } from "@/server/services/storage";

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
