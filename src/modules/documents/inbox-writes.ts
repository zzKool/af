// The inbox's writes (specs/documents US4, D32): archive / restore, OCR re-run. The pure rules are in inbox.ts.
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { Clock } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { canArchive, OCR_STUCK_AFTER_MS } from "@/modules/documents/inbox";

// MUST NOT import from next/* or src/components/*

export type ArchiveOutcome = {
  id: string;
  outcome: "archived" | "restored" | "refused" | "missing";
  /** why it was refused: not an inbox row (became, filed, generated, already archived) */
  reason?: "not_inbox" | "not_archived";
};

export const ARCHIVE_BULK_MAX = 50;

async function inboxFacts(tx: TransactionClient, ids: readonly string[]) {
  const docs = await tx.document.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      status: true,
      archivedAt: true,
      reviewedAt: true,
      updatedAt: true,
      documentType: true,
    },
  });
  const became = new Set(
    (
      await tx.link.findMany({
        where: { kind: "created_from", toType: "document", toId: { in: [...ids] } },
        select: { toId: true },
      })
    ).map((l) => l.toId),
  );
  return new Map(docs.map((d) => [d.id, { ...d, became: became.has(d.id) }]));
}

/**
 * Park inbox rows: `archived_at / archived_by` set, audited per document. A document that is not a live inbox
 * row (became something, filed, generated, already archived) is refused — archive is for parking, not history.
 * Per-id outcomes so the undo stack restores exactly what succeeded.
 */
export async function archiveDocuments(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  clock: Clock,
  ids: readonly string[],
): Promise<ServiceResult<ArchiveOutcome[]>> {
  if (!can(caller, "update", "financial_document")) {
    return { error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false } };
  }
  if (ids.length === 0 || ids.length > ARCHIVE_BULK_MAX) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `1 to ${ARCHIVE_BULK_MAX} documents at a time`,
        retryable: false,
      },
    };
  }
  const facts = await inboxFacts(tx, ids);
  const now = clock.now();
  const out: ArchiveOutcome[] = [];
  for (const id of ids) {
    const d = facts.get(id);
    if (!d) {
      out.push({ id, outcome: "missing" });
      continue;
    }
    if (!canArchive(d, now)) {
      out.push({ id, outcome: "refused", reason: "not_inbox" });
      continue;
    }
    await tx.document.update({
      where: { id },
      data: { archivedAt: now, archivedBy: caller.userId },
    });
    await audit.log({
      action: "update",
      entityType: "document",
      entityId: id,
      oldData: { archivedAt: null },
      newData: { archivedAt: now.toISOString(), archivedBy: caller.userId, event: "archive" },
    });
    out.push({ id, outcome: "archived" });
  }
  return { data: out };
}

/** Restore parked rows: the flag cleared, nothing else touched — the row comes back in its pipeline state. */
export async function unarchiveDocuments(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  ids: readonly string[],
): Promise<ServiceResult<ArchiveOutcome[]>> {
  if (!can(caller, "update", "financial_document")) {
    return { error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false } };
  }
  if (ids.length === 0 || ids.length > ARCHIVE_BULK_MAX) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `1 to ${ARCHIVE_BULK_MAX} documents at a time`,
        retryable: false,
      },
    };
  }
  const docs = await tx.document.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, archivedAt: true },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  const out: ArchiveOutcome[] = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) {
      out.push({ id, outcome: "missing" });
      continue;
    }
    if (!d.archivedAt) {
      out.push({ id, outcome: "refused", reason: "not_archived" });
      continue;
    }
    await tx.document.update({ where: { id }, data: { archivedAt: null, archivedBy: null } });
    await audit.log({
      action: "update",
      entityType: "document",
      entityId: id,
      oldData: { archivedAt: d.archivedAt.toISOString() },
      newData: { archivedAt: null, event: "restore" },
    });
    out.push({ id, outcome: "restored" });
  }
  return { data: out };
}

/**
 * Re-run the OCR (specs/documents US4, FR-021): a failed or stuck document goes back to `uploaded` so the job
 * claims it again; a completed one only with `force` (its corrections stay, the extracted facts are replaced).
 * The action enqueues the job after the commit (`singletonKey` = the document — one run at a time).
 */
export async function prepareOcrRerun(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  clock: Clock,
  documentId: string,
  options: { force?: boolean } = {},
): Promise<ServiceResult<{ id: string; previousStatus: string }>> {
  if (!can(caller, "update", "financial_document")) {
    return { error: { code: "FORBIDDEN", message: "Requires owner role", retryable: false } };
  }
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { id: true, status: true, updatedAt: true, archivedAt: true, reviewedAt: true },
  });
  if (!doc) {
    return { error: { code: "NOT_FOUND", message: "Document not found", retryable: false } };
  }
  const stuck =
    doc.status === "processing" &&
    clock.now().getTime() - doc.updatedAt.getTime() > OCR_STUCK_AFTER_MS;
  const allowed =
    doc.status === "ocr_failed" ||
    doc.status === "uploaded" ||
    stuck ||
    (doc.status === "extracted" && options.force === true);
  if (!allowed) {
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message:
          doc.status === "extracted"
            ? "The OCR already ran — re-run it from the review page"
            : `Cannot run the OCR on a ${doc.status} document`,
        retryable: false,
      },
    };
  }
  if (doc.status !== "uploaded") {
    await tx.document.update({ where: { id: documentId }, data: { status: "uploaded" } });
  }
  await audit.log({
    action: "update",
    entityType: "document",
    entityId: documentId,
    oldData: { status: doc.status },
    newData: { status: "uploaded", event: "ocr_rerun", forced: options.force === true },
  });
  return { data: { id: documentId, previousStatus: doc.status } };
}
