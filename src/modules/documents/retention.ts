// Retention (story 5.5): delete, refused for a generated or a linked document (derived from the links); every
// owner attempt on an existing document audited.
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { dropProposalsForDocuments, isLinked } from "@/modules/linking";

// MUST NOT import from next/* or src/components/*

export async function deleteDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  documentId: string,
): Promise<ServiceResult<{ businessKey: string; blobUrl: string }>> {
  if (!can(caller, "delete", "financial_document")) {
    return {
      error: { code: "FORBIDDEN", message: "Only owners can delete documents", retryable: false },
    };
  }

  const doc = await tx.document.findUnique({ where: { id: documentId } });
  if (!doc) {
    return { error: { code: "NOT_FOUND", message: "Document not found", retryable: false } };
  }

  // A generated document (an issued invoice's PDF) is the proof of an immutable record — it lives as long as
  // its source does, and the source is never deleted.
  if (doc.status === "generated") {
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message: `Cannot delete — ${doc.businessKey} was generated from an issued document`,
        retryable: false,
      },
    };
  }

  // Linked = any link touching it, derived through linking — the same test as the database trigger
  // documents_block_delete_when_linked, checked first: once the trigger raises, the transaction is aborted and
  // not even the "blocked" audit row could be written.
  if (await isLinked(tx, { type: "document", id: documentId })) {
    await audit.log({
      action: "delete",
      entityType: "document",
      entityId: documentId,
      oldData: toAuditData(doc),
      newData: { outcome: "blocked", reason: "linked" },
    });
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message: "Cannot delete — the document is linked",
        retryable: false,
      },
    };
  }

  // its proposals go first (F126: the composite FK is RESTRICT, D63 forbids the cascade)
  await dropProposalsForDocuments(tx, [documentId]);
  await tx.document.delete({ where: { id: documentId } });
  await audit.log({
    action: "delete",
    entityType: "document",
    entityId: documentId,
    oldData: toAuditData(doc),
    newData: { outcome: "deleted" },
  });

  return { data: { businessKey: doc.businessKey, blobUrl: doc.blobUrl } };
}
