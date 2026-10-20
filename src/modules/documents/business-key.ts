// Provisional business key of a raw upload — a fixed function (D6), no prefix table (4.4).
// `exp_20261020_001`: kind prefix + upload date + sequence in the month's `doc-yyyy-mm` series.
// A document gets its final key when it becomes something: an expense receipt (`Ex213-Tr-01_…_`),
// an issued invoice (`InvoiceAF_VA26-001.pdf`) — those functions live in modules/numbering too.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { Clock } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import {
  isUploadKind,
  nextInSeries,
  UPLOAD_KINDS,
  type UploadKind,
  uploadDocumentKey,
  uploadSeries,
} from "@/modules/numbering";

const CLASSIFICATION_MAP: Record<UploadKind, "financial" | "relationship"> = {
  expense: "financial",
  invoice: "financial",
  contract: "relationship",
  nda: "relationship",
  certificate: "relationship",
};

export function getDocumentClassification(
  prefixType: string,
): "financial" | "relationship" | undefined {
  return isUploadKind(prefixType) ? CLASSIFICATION_MAP[prefixType] : undefined;
}

/** What the upload form offers: the fixed kinds (was the tenant's prefix rows). */
export function getUploadKinds(): UploadKind[] {
  return [...UPLOAD_KINDS];
}

export async function generateBusinessKey(
  tx: TransactionClient,
  caller: CallerIdentity,
  prefixType: string,
  clock: Clock,
): Promise<ServiceResult<{ businessKey: string; documentType: "financial" | "relationship" }>> {
  if (!isUploadKind(prefixType)) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Unknown document kind "${prefixType}" (expected one of ${UPLOAD_KINDS.join(", ")})`,
        retryable: false,
      },
    };
  }
  const today = clock.today();
  const seq = await nextInSeries(tx, caller, uploadSeries(today));
  return {
    data: {
      businessKey: uploadDocumentKey(prefixType, today, seq),
      documentType: CLASSIFICATION_MAP[prefixType],
    },
  };
}
