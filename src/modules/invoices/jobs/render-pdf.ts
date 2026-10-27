// The PDF of an issued document (D7, invoice-pdf skill): rendered ONCE, by a job, from the print route the
// sheet serves; stored through the documents module as `InvoiceAF_{number}.pdf`; referenced by
// `pdf_document_id` — the one column the lock lets through, once. Re-downloads serve the stored document.
import { createAuditEntry } from "@/kernel/audit/audit";
import { withJobContext } from "@/kernel/jobs/context";
import type { JobContext, JobDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import { renderPathToPdf } from "@/kernel/pdf/pdf";
import { createStorageService } from "@/kernel/storage/storage";
import * as documents from "@/modules/documents";
import { invoicePdfKey } from "@/modules/numbering";

export interface RenderInvoicePdfData {
  tenantId: string;
  userId: string;
  invoiceId: string;
}

export function printPath(invoiceId: string): string {
  return `/print/invoice/${invoiceId}`;
}

async function handler({ tenantId, userId, invoiceId }: RenderInvoicePdfData) {
  // 1. Only issued documents without a PDF — idempotent across retries and duplicate enqueues.
  const target = await withJobContext(tenantId, userId, async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, number: true, status: true, pdfDocumentId: true },
    });
    if (!inv || inv.status === "draft" || !inv.number) return null;
    if (inv.pdfDocumentId) return { done: true as const, number: inv.number };
    return { done: false as const, number: inv.number };
  });
  if (!target) {
    logger.warn({ invoiceId }, "invoices.render-pdf: no issued document, skipping");
    return;
  }
  if (target.done) return;

  // 2. Chromium (outside any transaction — ~1 s).
  const bytes = await renderPathToPdf(printPath(invoiceId), { tenantId, userId });

  // 3. Store + reference (short transaction). The lock trigger refuses a second pdf_document_id, so a race
  //    between two attempts cannot leave two PDFs referenced.
  const storage = createStorageService();
  await withJobContext(tenantId, userId, async (tx) => {
    const caller = { tenantId, userId, role: "owner" as const, source: "system" as const };
    const audit = {
      log: (p: Parameters<typeof createAuditEntry>[2]) => createAuditEntry(tx, caller, p),
    };
    const key = invoicePdfKey(target.number);
    const stored = await documents.storeGeneratedDocument(tx, caller, audit, storage, {
      bytes,
      businessKey: key,
      fileName: key,
      mimeType: "application/pdf",
      prefixType: "invoice",
    });
    if (stored.error) throw new Error(`invoices.render-pdf: ${stored.error.message}`);
    await tx.invoice.update({ where: { id: invoiceId }, data: { pdfDocumentId: stored.data.id } });
    await audit.log({
      action: "update",
      entityType: "invoice",
      entityId: invoiceId,
      newData: { pdfDocumentId: stored.data.id, businessKey: key },
    });
  });
  logger.info({ invoiceId, number: target.number }, "invoices.render-pdf: stored");
}

/** After the last retry (F110): the failure goes on the invoice's trail, so the page and the History say why. */
async function markRenderFailed(
  { tenantId, userId, invoiceId }: RenderInvoicePdfData,
  ctx: JobContext,
): Promise<void> {
  logger.error(
    { invoiceId, failure: ctx.failure },
    "invoices.render-pdf: failed after all retries",
  );
  await withJobContext(tenantId, userId, async (tx, _caller, audit) => {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { pdfDocumentId: true },
    });
    if (!inv || inv.pdfDocumentId) return; // gone, or an attempt got through after all
    await audit.log({
      action: "update",
      entityType: "invoice",
      entityId: invoiceId,
      newData: {
        pdfRender: "failed",
        error: ctx.failure?.error ?? "unknown error",
        attempts: ctx.failure?.attempts ?? null,
      },
    });
  });
}

export const renderInvoicePdfJob: JobDefinition<RenderInvoicePdfData> = {
  name: "invoices.render-pdf",
  options: {
    policy: "exclusive",
    retryLimit: 5,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 120,
  },
  handler,
  onDeadLetter: markRenderFailed,
};

export const invoiceJobs = [renderInvoicePdfJob];
