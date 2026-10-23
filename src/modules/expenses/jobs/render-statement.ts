// The reimbursement statement PDF (US4-7, FR-009): rendered ONCE by a job from the print route, stored through the
// documents module as `Reimb_ST26-001_2026-03-31.pdf`, referenced by `statement_document_id` (the lock lets it
// through once) and linked `justifies` from the refund's bank row — the justification the refund never had.
import { withJobContext } from "@/kernel/jobs/context";
import type { JobDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import { renderPathToPdf } from "@/kernel/pdf/pdf";
import { createStorageService } from "@/kernel/storage/storage";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as linking from "@/modules/linking";
import { statementPdfKey } from "@/modules/numbering";

export interface RenderStatementData {
  tenantId: string;
  userId: string;
  settlementId: string;
}

export function statementPrintPath(settlementId: string): string {
  return `/print/settlement/${settlementId}`;
}

/** Test seam: the renderer (Chromium) is injected so the job's storage / reference / link path runs without it. */
export type Renderer = (
  path: string,
  identity: { tenantId: string; userId: string },
) => Promise<Buffer>;

export async function renderStatement(
  { tenantId, userId, settlementId }: RenderStatementData,
  render: Renderer = renderPathToPdf,
): Promise<void> {
  // 1. Only active settlements without a statement — idempotent across retries and duplicate enqueues.
  const target = await withJobContext(tenantId, userId, async (tx) => {
    const s = await tx.settlement.findUnique({
      where: { id: settlementId },
      select: {
        id: true,
        number: true,
        status: true,
        statementDocumentId: true,
        bankTransactionId: true,
      },
    });
    if (!s) return null;
    if (s.statementDocumentId) return { done: true as const, number: s.number };
    if (s.status !== "active") return null;
    const t = await banking.getBankTransaction(tx, s.bankTransactionId);
    return {
      done: false as const,
      number: s.number,
      bookingDate: t?.bookingDate ?? null,
      bankTransactionId: s.bankTransactionId,
    };
  });
  if (!target) {
    logger.warn({ settlementId }, "expenses.render-statement: no active settlement, skipping");
    return;
  }
  if (target.done) return;

  // 2. Chromium (outside any transaction).
  const bytes = await render(statementPrintPath(settlementId), { tenantId, userId });

  // 3. Store + reference + link (short transaction). The lock trigger refuses a second statement_document_id.
  const storage = createStorageService();
  await withJobContext(tenantId, userId, async (tx, caller, audit) => {
    const key = statementPdfKey(target.number, target.bookingDate ?? "1970-01-01");
    const stored = await documents.storeGeneratedDocument(tx, caller, audit, storage, {
      bytes,
      businessKey: key,
      fileName: key,
      mimeType: "application/pdf",
      prefixType: "expense",
    });
    if (stored.error) throw new Error(`expenses.render-statement: ${stored.error.message}`);
    await tx.settlement.update({
      where: { id: settlementId },
      data: { statementDocumentId: stored.data.id },
    });
    await audit.log({
      action: "update",
      entityType: "settlement",
      entityId: settlementId,
      newData: { statementDocumentId: stored.data.id, businessKey: key },
    });
    const link = await linking.createLink(tx, caller, audit, {
      from: { type: "bank_transaction", id: target.bankTransactionId },
      to: { type: "document", id: stored.data.id },
      kind: "justifies",
    });
    if (link.error) throw new Error(`expenses.render-statement: ${link.error.message}`);
  });
  logger.info({ settlementId, number: target.number }, "expenses.render-statement: stored");
}

export const renderStatementJob: JobDefinition<RenderStatementData> = {
  name: "expenses.render-statement",
  options: {
    policy: "exclusive",
    retryLimit: 5,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 120,
  },
  handler: (data) => renderStatement(data),
};

export const expenseJobs = [renderStatementJob];
