import { withJobContext } from "@/kernel/jobs/context";
import type { JobDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import { OCR_MAX_RETRIES } from "@/kernel/nav/constants";
import {
  createOcrService,
  extractBlobPath,
  type OcrResult,
  type OcrSource,
} from "@/kernel/ocr/ocr";
import { createStorageService } from "@/kernel/storage/storage";
import { ocrPayloadToJson } from "@/modules/documents/ocr-payload";

/**
 * What runs after a document's facts are read (F126: linking's BAS proposal). Wired in `instrumentation.ts` — a
 * cross-module hook, never a module import; nothing by default (tests, scripts). A failure is logged, never the
 * document's: the proposal is a convenience, the nightly run catches up.
 */
type OnExtracted = (data: ProcessDocumentData) => Promise<void>;
let onExtracted: OnExtracted = async () => {};
export function setOnDocumentExtracted(fn: OnExtracted): void {
  onExtracted = fn;
}

export interface ProcessDocumentData {
  tenantId: string;
  userId: string;
  documentId: string;
}

/**
 * Process an uploaded document (OCR, metadata extraction).
 *
 * Resumable by design: the job carries ids only, the state machine lives on the document
 * (uploaded → processing → extracted | ocr_failed). Every attempt reads the status and does what is
 * left, so a retry after a crash or a restart is always safe:
 *   1. uploaded → processing            (short RLS transaction)
 *   2. OCR                              (outside any transaction — Azure DI takes 10–15 s)
 *   3. processing → extracted | failed  (short RLS transaction)
 * Throwing retries the job (OCR_MAX_RETRIES); when retries are exhausted or an attempt expires,
 * pg-boss moves the job to the dead-letter queue and `onDeadLetter` marks the document ocr_failed.
 */
async function processDocumentHandler({ tenantId, userId, documentId }: ProcessDocumentData) {
  // 1. Claim: uploaded → processing. Any other status means an earlier attempt got here already.
  const claimed = await withJobContext(tenantId, userId, async (tx) => {
    const document = await tx.document.findUnique({ where: { id: documentId } });
    if (!document) return { found: false as const };
    if (document.status === "uploaded") {
      await tx.document.update({ where: { id: documentId }, data: { status: "processing" } });
    }
    return { found: true as const };
  });
  if (!claimed.found) {
    // Rolled-back upload or deleted since — nothing to resume, nothing to retry.
    logger.warn({ documentId }, "process-document: document not found, skipping");
    return;
  }

  // 2a. Short transaction: read the document and prepare the OCR source.
  const prepared = await withJobContext(tenantId, userId, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId } });
    if (!doc) return { skipped: true as const, reason: "not found" };
    if (doc.status !== "processing") return { skipped: true as const, reason: doc.status };

    const storage = createStorageService();
    const blobPath = extractBlobPath(doc.blobUrl);
    let source: OcrSource;
    if (!isReachableAzureBlob(doc.blobUrl)) {
      // Azurite — on 127.0.0.1 locally, on `azurite:10000` inside the prod compose — is not reachable from
      // Azure DI (nor from the mock OCR): send the bytes. Only a real Azure Blob URL goes out as a SAS link.
      const fileBuffer = await storage.downloadBlob(blobPath);
      source = { type: "buffer", buffer: fileBuffer, mimeType: doc.mimeType };
    } else {
      const sasUrl = await storage.generateSasUrl(blobPath, 5);
      source = { type: "url", url: sasUrl, mimeType: doc.mimeType };
    }
    return { skipped: false as const, source, prefixType: doc.prefixType };
  });
  if (prepared.skipped) {
    logger.info({ documentId, reason: prepared.reason }, "process-document: nothing left to do");
    return;
  }

  // 2b. OCR — outside any transaction.
  const ocrService = createOcrService();
  const result: OcrResult = await ocrService.analyzeDocument(prepared.source, prepared.prefixType);
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

  if (!result.success && result.retryable) {
    throw new Error(result.error); // pg-boss retries with backoff; dead-letter after OCR_MAX_RETRIES
  }

  // 3. Save: processing → extracted | ocr_failed.
  const extracted = await withJobContext(tenantId, userId, async (tx, _caller, audit) => {
    if (result.success) {
      const ocrPayload = {
        extractedData: result.data,
        rawResponse: result.rawResponse,
        quality: result.quality,
      };
      await tx.document.update({
        where: { id: documentId },
        data: { status: "extracted", ocrData: ocrPayloadToJson(ocrPayload) },
      });
      await audit.log({
        action: "update",
        entityType: "document",
        entityId: documentId,
        oldData: { status: "processing" },
        newData: { status: "extracted", quality: result.quality },
      });
      return true;
    }
    // Non-retryable OCR failure (auth, unsupported file): final.
    await tx.document.update({ where: { id: documentId }, data: { status: "ocr_failed" } });
    await audit.log({
      action: "update",
      entityType: "document",
      entityId: documentId,
      oldData: { status: "processing" },
      newData: { status: "ocr_failed", error: result.error },
    });
    return false;
  });
  if (extracted) {
    try {
      await onExtracted({ tenantId, userId, documentId });
    } catch (e) {
      logger.warn(
        { documentId, error: e instanceof Error ? e.name : "unknown" },
        "process-document: the after-extraction hook failed",
      );
    }
  }
}

/** Safety net after the last retry: a document must never stay in `processing`. Idempotent. */
async function markFailed({ tenantId, userId, documentId }: ProcessDocumentData) {
  logger.error({ documentId }, "OCR processing failed after all retries");
  await withJobContext(tenantId, userId, async (tx, _caller, audit) => {
    const doc = await tx.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.status !== "processing") return; // already extracted / failed / gone
    await tx.document.update({ where: { id: documentId }, data: { status: "ocr_failed" } });
    await audit.log({
      action: "update",
      entityType: "document",
      entityId: documentId,
      oldData: { status: "processing" },
      newData: { status: "ocr_failed" },
    });
  });
}

/**
 * Can Azure Document Intelligence fetch this blob by URL? Only a real Azure Storage blob (https, `*.blob.core.windows.net`).
 * Anything else — Azurite on 127.0.0.1 or on the compose network (`http://azurite:10000/…`) — must be sent as bytes.
 */
export function isReachableAzureBlob(blobUrl: string): boolean {
  try {
    const url = new URL(blobUrl);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.core.windows.net");
  } catch {
    return false;
  }
}

export const processDocumentJob: JobDefinition<ProcessDocumentData> = {
  name: "documents.process-document",
  options: {
    policy: "exclusive", // one job per document queued or active (singletonKey = documentId)
    retryLimit: OCR_MAX_RETRIES,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  handler: processDocumentHandler,
  onDeadLetter: markFailed,
};

export const documentJobs = [processDocumentJob] as const;
