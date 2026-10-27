"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { enqueue } from "@/kernel/jobs/queue";
import { listQuerySchema } from "@/kernel/list-query/schema";
import { isoDate, uuid } from "@/kernel/validation/scalars";
import * as invoiceService from "@/modules/invoices/invoices";
import { renderInvoicePdfJob } from "@/modules/invoices/jobs/render-pdf";
import {
  distinctInvoiceValues,
  getInvoice,
  INVOICE_COLUMN_KEYS,
  type InvoiceColumn,
  invoiceDateHierarchy,
  listInvoices,
  nextNumberHint,
  relatedDocuments,
} from "@/modules/invoices/queries";

const clock = createClock();
const columnSchema = z.enum(INVOICE_COLUMN_KEYS as [InvoiceColumn, ...InvoiceColumn[]]);
const forbidden = {
  error: { code: "FORBIDDEN" as const, message: "Not allowed to read invoices", retryable: false },
};

// --- reads (the accountant may read) ---

export const getInvoiceAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "getInvoice" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "invoice")) return forbidden;
    return getInvoice(ctx.tx, parsedInput.id, clock.today());
  });

export const listInvoicesAction = authedAction
  .schema(z.object({ query: listQuerySchema }))
  .metadata({ name: "listInvoices" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "invoice")) return forbidden;
    return { data: await listInvoices(ctx.tx, parsedInput.query, clock.today()) };
  });

export const distinctInvoicesAction = authedAction
  .schema(z.object({ column: columnSchema, query: listQuerySchema }))
  .metadata({ name: "distinctInvoices" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "invoice")) return forbidden;
    return {
      data: await distinctInvoiceValues(
        ctx.tx,
        parsedInput.column,
        parsedInput.query,
        clock.today(),
      ),
    };
  });

export const invoiceDateHierarchyAction = authedAction
  .schema(z.object({ column: columnSchema, query: listQuerySchema }))
  .metadata({ name: "invoiceDateHierarchy" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "invoice")) return forbidden;
    return {
      data: await invoiceDateHierarchy(
        ctx.tx,
        parsedInput.column,
        parsedInput.query,
        clock.today(),
      ),
    };
  });

export const relatedDocumentsAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "relatedInvoiceDocuments" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "invoice")) return forbidden;
    return { data: await relatedDocuments(ctx.tx, parsedInput.id) };
  });

export const nextNumberHintAction = ownerAction
  .schema(
    z.object({
      type: z.enum(["quote", "invoice", "credit_note"]),
      partnerShortCode: z.string().nullable(),
      issueDate: isoDate,
    }),
  )
  .metadata({ name: "nextInvoiceNumberHint" })
  .action(async ({ ctx, parsedInput }) => {
    return {
      data: await nextNumberHint(
        ctx.tx,
        parsedInput.type,
        parsedInput.partnerShortCode,
        parsedInput.issueDate,
      ),
    };
  });

// --- writes (owner only) ---

export const createDraftAction = ownerAction
  .schema(invoiceService.createDraftSchema)
  .metadata({ name: "createInvoiceDraft" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.createDraft(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock.today(),
      parsedInput,
    );
  });

export const updateDraftAction = ownerAction
  .schema(invoiceService.updateDraftSchema)
  .metadata({ name: "updateInvoiceDraft" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.updateDraft(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

export const deleteDraftAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteInvoiceDraft" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.deleteDraft(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

/** Issue: number, base amounts, declaration period, snapshot, lock; the PDF job is enqueued once committed. */
export const issueInvoiceAction = ownerAction
  .schema(invoiceService.issueSchema)
  .metadata({ name: "issueInvoice" })
  .action(async ({ ctx, parsedInput }) => {
    const result = await invoiceService.issue(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock.now(),
      parsedInput,
    );
    if (result.data) {
      const { tenantId, userId } = ctx.callerIdentity;
      const invoiceId = result.data.id;
      ctx.onCommit(async () => {
        await enqueue(
          renderInvoicePdfJob,
          { tenantId, userId, invoiceId },
          { singletonKey: invoiceId },
        );
      });
    }
    return result;
  });

/**
 * F110: the one-click requeue. The PDF job is exclusive per invoice, so a render still queued or running is
 * not doubled (`queued: false`); a job that failed terminally gets a fresh one. Nothing to do once the PDF is
 * there.
 */
export const requeueInvoicePdfAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "requeueInvoicePdf" })
  .action(async ({ ctx, parsedInput }) => {
    const found = await getInvoice(ctx.tx, parsedInput.id, clock.today());
    if (found.error) return found;
    const inv = found.data;
    if (inv.status === "draft" || inv.pdfDocumentId) return { data: { queued: false } };
    const { tenantId, userId } = ctx.callerIdentity;
    const invoiceId = inv.id;
    let queued = false;
    ctx.onCommit(async () => {
      queued =
        (await enqueue(
          renderInvoicePdfJob,
          { tenantId, userId, invoiceId },
          { singletonKey: invoiceId },
        )) !== null;
    });
    return { data: { queued } };
  });

export const markSentAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "markInvoiceSent" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.markSent(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock.now(),
      parsedInput.id,
    );
  });

export const decideQuoteAction = ownerAction
  .schema(z.object({ id: uuid, decision: z.enum(["accepted", "declined"]) }))
  .metadata({ name: "decideQuote" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.decideQuote(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock.now(),
      parsedInput.id,
      parsedInput.decision,
    );
  });

export const convertQuoteAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "convertQuote" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.convertQuote(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock.today(),
      parsedInput.id,
    );
  });

export const copyToDraftAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "copyInvoiceToDraft" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.copyToDraft(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock.today(),
      parsedInput.id,
    );
  });

export const createCreditNoteAction = ownerAction
  .schema(invoiceService.creditNoteSchema)
  .metadata({ name: "createCreditNote" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.createCreditNote(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      clock.today(),
      parsedInput,
    );
  });

export const setDeclarationPeriodAction = ownerAction
  .schema(invoiceService.declarationPeriodSchema)
  .metadata({ name: "setInvoiceDeclarationPeriod" })
  .action(async ({ ctx, parsedInput }) => {
    return invoiceService.setDeclarationPeriod(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });
