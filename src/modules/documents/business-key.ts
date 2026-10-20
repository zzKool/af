import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { Clock } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { getDocumentTypePrefixesWithSeed } from "@/modules/documents/document-type-prefixes";

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

const CLASSIFICATION_MAP: Record<string, "financial" | "relationship"> = {
  expense: "financial",
  invoice: "financial",
  contract: "relationship",
  nda: "relationship",
  certificate: "relationship",
};

export function getDocumentClassification(
  prefixType: string,
): "financial" | "relationship" | undefined {
  return CLASSIFICATION_MAP[prefixType];
}

export async function generateBusinessKey(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  prefixType: string,
  clock: Clock,
): Promise<ServiceResult<{ businessKey: string; documentType: "financial" | "relationship" }>> {
  const classification = getDocumentClassification(prefixType);
  if (!classification) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Unknown prefix type: "${prefixType}". Configure in Settings > Document Prefixes`,
        retryable: false,
      },
    };
  }

  // Look up the prefix string for this prefix type
  const prefixResult = await getDocumentTypePrefixesWithSeed(tx, caller, audit);
  if (prefixResult.error) return { error: prefixResult.error };

  const prefixEntry = prefixResult.data.find((p) => p.documentType === prefixType);
  if (!prefixEntry) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Document type prefix not configured for "${prefixType}". Configure in Settings > Document Prefixes`,
        retryable: false,
      },
    };
  }

  const dateStr = clock.today().replace(/-/g, "");
  const yearMonth = clock.currentPeriod();

  // Atomic counter increment
  const result = await tx.$queryRawUnsafe<{ next_val: number }[]>(
    `INSERT INTO document_key_counters (tenant_id, year_month, next_val)
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year_month)
     DO UPDATE SET next_val = document_key_counters.next_val + 1
     RETURNING next_val`,
    caller.tenantId,
    yearMonth,
  );

  const seqNum = result[0].next_val;
  const businessKey = `${prefixEntry.prefix}${dateStr}_${String(seqNum).padStart(3, "0")}`;

  return { data: { businessKey, documentType: classification } };
}
