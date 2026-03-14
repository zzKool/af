import { NonRetriableError } from "inngest";
import { logger } from "@/server/logger";
import {
  createOcrService,
  extractBlobPath,
  type OcrResult,
  type OcrSource,
} from "@/server/services/ocr";
import { createStorageService } from "@/server/services/storage";
import { inngest } from "../client";
import { withInngestContext } from "../context";

/**
 * Process an uploaded document (OCR, metadata extraction).
 *
 * 3-step Inngest architecture:
 *   Step 1: update-status-to-processing (memoized — never re-runs on retry)
 *   Step 2: run-ocr-analysis (expensive Azure DI call — memoized separately)
 *   Step 3: save-ocr-result (cheap DB write — retryable without re-running OCR)
 *   onFailure: safety net — marks document as ocr_failed if all retries exhausted
 */
export const processDocument = inngest.createFunction(
  {
    id: "process-document",
    retries: 3,
    onFailure: async ({ event, error }) => {
      // CRITICAL: onFailure receives NESTED event — event.data.event.data, NOT event.data
      const { tenantId, userId, documentId } = event.data.event.data as {
        tenantId: string;
        userId: string;
        documentId: string;
      };
      logger.error({ documentId, error: error.message }, "OCR processing failed after all retries");

      await withInngestContext(tenantId, userId, async (tx, _caller, audit) => {
        const doc = await tx.document.findUnique({ where: { id: documentId } });
        if (doc && doc.status === "processing") {
          await tx.document.update({
            where: { id: documentId },
            data: { status: "ocr_failed" },
          });
          await audit.log({
            action: "update",
            entityType: "document",
            entityId: documentId,
            oldData: { status: "processing" },
            newData: { status: "ocr_failed" },
          });
        }
        // If doc is already ocr_failed or extracted, skip — idempotent
      });
    },
  },
  { event: "document/uploaded" },
  async ({ event, step }) => {
    const { tenantId, userId, documentId } = event.data;

    // Step 1: Update status to processing (existing from Story 5.1, memoized)
    await step.run("update-status-to-processing", async () => {
      return withInngestContext(tenantId, userId, async (tx, _caller, _audit) => {
        const document = await tx.document.findUnique({
          where: { id: documentId },
        });

        if (!document) {
          throw new NonRetriableError(
            `Document ${documentId} not found — likely from a rolled-back transaction`,
          );
        }

        if (document.status !== "uploaded") {
          return { documentId, status: document.status, skipped: true };
        }

        await tx.document.update({
          where: { id: documentId },
          data: { status: "processing" },
        });

        return { documentId, status: "processing" };
      });
    });

    // Step 2: Run OCR analysis (expensive, memoized separately)
    type OcrStepResult = OcrResult | { skipped: true; status: string };
    const ocrResult: OcrStepResult = await step.run("run-ocr-analysis", async () => {
      return withInngestContext<OcrStepResult>(tenantId, userId, async (tx, _caller, _audit) => {
        const doc = await tx.document.findUnique({ where: { id: documentId } });
        if (!doc) throw new NonRetriableError("Document not found");
        if (doc.status !== "processing") return { skipped: true as const, status: doc.status };

        // Determine source: SAS URL (production) or buffer (local dev fallback)
        const storage = createStorageService();
        const blobPath = extractBlobPath(doc.blobUrl);
        let source: OcrSource;

        const isLocalBlob = doc.blobUrl.includes("127.0.0.1") || doc.blobUrl.includes("localhost");
        const isRemoteOcr = !!process.env.AZURE_DI_ENDPOINT?.includes("azure");

        if (isLocalBlob && isRemoteOcr) {
          // Local Azurite + remote Azure DI → must download buffer
          const fileBuffer = await storage.downloadBlob(blobPath);
          source = { type: "buffer", buffer: fileBuffer, mimeType: doc.mimeType };
        } else if (!isLocalBlob) {
          // Cloud blob → use SAS URL (zero memory, Azure-to-Azure network)
          const sasUrl = await storage.generateSasUrl(blobPath, 5);
          source = { type: "url", url: sasUrl };
        } else {
          // Local blob + local/mock OCR → buffer is fine
          const fileBuffer = await storage.downloadBlob(blobPath);
          source = { type: "buffer", buffer: fileBuffer, mimeType: doc.mimeType };
        }

        const ocrService = createOcrService();
        const result = await ocrService.analyzeDocument(source, doc.prefixType);

        // Log metrics ONLY — NEVER log ocrData contents (contains IBANs, tax IDs, amounts)
        logger.info(
          {
            documentId,
            modelUsed: result.success ? result.data.modelUsed : "n/a",
            confidence: result.success ? result.data.confidence : 0,
            durationMs: result.success ? result.data.processingTimeMs : 0,
            success: result.success,
          },
          "OCR analysis complete",
        );

        return result;
      });
    });

    // Step 3: Save OCR result (cheap DB write, retryable without re-running OCR)
    await step.run("save-ocr-result", async () => {
      // Skip if document was not in 'processing' state
      if ("skipped" in ocrResult) return ocrResult;

      // Narrow to OcrResult (discriminated on `success`)
      const result = ocrResult as OcrResult;

      return withInngestContext(tenantId, userId, async (tx, _caller, audit) => {
        if (result.success) {
          const ocrPayload = {
            extractedData: result.data,
            rawResponse: result.rawResponse,
            quality: result.quality,
          };
          await tx.document.update({
            where: { id: documentId },
            // biome-ignore lint/suspicious/noExplicitAny: Prisma's InputJsonValue is too narrow for our JSONB shape
            data: { status: "extracted", ocrData: ocrPayload as any },
          });
          await audit.log({
            action: "update",
            entityType: "document",
            entityId: documentId,
            oldData: { status: "processing" },
            newData: { status: "extracted", quality: result.quality },
          });
          return { documentId, status: "extracted", quality: result.quality };
        }

        if (result.retryable) {
          throw new Error(result.error); // triggers Inngest retry
        }

        // Non-retryable: mark as failed
        await tx.document.update({
          where: { id: documentId },
          data: { status: "ocr_failed" },
        });
        await audit.log({
          action: "update",
          entityType: "document",
          entityId: documentId,
          oldData: { status: "processing" },
          newData: { status: "ocr_failed" },
        });
        return { documentId, status: "ocr_failed", error: result.error };
      });
    });
  },
);
