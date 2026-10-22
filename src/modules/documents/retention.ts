// Retention (story 5.5): delete, refused for a linked or generated document; every attempt audited.
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";

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

  if (doc.status === "linked") {
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
        message: "Cannot delete — document is linked to a journal entry",
        retryable: false,
      },
    };
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

  // Linked documents cannot be hard-deleted: the database trigger documents_block_delete_when_linked
  // (migration 20261020060000_add_links) raises 'document_linked'; translated below.
  // once document-transaction linking is implemented.
  await audit.log({
    action: "delete",
    entityType: "document",
    entityId: documentId,
    oldData: toAuditData(doc),
    newData: { outcome: "deleted" },
  });

  try {
    await tx.document.delete({ where: { id: documentId } });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("document_linked")) {
      await audit.log({
        action: "delete",
        entityType: "document",
        entityId: documentId,
        newData: { outcome: "blocked", reason: "linked" },
      });
      return {
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: "Cannot delete — document is linked",
          retryable: false,
        },
      };
    }
    throw error;
  }

  return { data: { businessKey: doc.businessKey, blobUrl: doc.blobUrl } };
}
