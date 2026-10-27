// The one way a document's bytes reach a browser (F106, D61 — audit 2026-10-27 D2): the authenticated route
// `GET /api/documents/[id]/file` asks this service *which* bytes the caller may have, then streams them from the
// storage adapter. No SAS URL is ever handed to the browser — the storage's host (`azurite:10000` inside the
// compose, a folder once the fs driver exists) is the server's business, and the accountant's financial-only
// rule is applied here, once, for the preview and the download alike.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can, documentSubject } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { extractBlobPath } from "@/kernel/ocr/ocr";

export interface DocumentBytes {
  blobPath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

/** The route's path for a document's bytes — inline for the preview, `download=1` for *Save as…*. Pure. */
export function documentFileUrl(documentId: string, options: { download?: boolean } = {}): string {
  return `/api/documents/${documentId}/file${options.download ? "?download=1" : ""}`;
}

/** What the caller may read of this document: its blob and how to serve it — or NOT_FOUND / FORBIDDEN. */
export async function documentFile(
  tx: TransactionClient,
  caller: CallerIdentity,
  documentId: string,
): Promise<ServiceResult<DocumentBytes>> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { blobUrl: true, fileName: true, mimeType: true, fileSize: true, documentType: true },
  });
  if (!doc) {
    return {
      error: { code: "NOT_FOUND", message: `Document not found: ${documentId}`, retryable: false },
    };
  }
  // the accountant reads financial documents only; the owner everything (can(), one table)
  if (!can(caller, "read", documentSubject(doc.documentType))) {
    return {
      error: {
        code: "FORBIDDEN",
        message: "Access denied to non-financial documents",
        retryable: false,
      },
    };
  }
  return {
    data: {
      blobPath: extractBlobPath(doc.blobUrl),
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
    },
  };
}

/** RFC 6266: an ASCII fallback plus the UTF-8 name, so `Faktura_Ö.pdf` saves as itself. Pure. */
export function contentDisposition(fileName: string, download: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
