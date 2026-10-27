"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import { listQuerySchema } from "@/kernel/list-query/schema";
import { isoDate, uuid } from "@/kernel/validation/scalars";
import { toSupplierInvoiceDetailWire } from "@/modules/supplier-invoices/detail-wire";
import { findSupplierInvoiceDuplicates } from "@/modules/supplier-invoices/duplicates";
import * as payments from "@/modules/supplier-invoices/payments";
import {
  candidateDocuments,
  copyLastPrefill,
  distinctSupplierInvoiceValues,
  getSupplierInvoiceDetail,
  inputVatForPeriod,
  kpis,
  listSupplierInvoices,
  payableTransactions,
  SUPPLIER_INVOICE_COLUMN_KEYS,
  type SupplierInvoiceColumn,
  supplierInvoiceDateHierarchy,
  supplierOptions,
} from "@/modules/supplier-invoices/queries";
import * as service from "@/modules/supplier-invoices/supplier-invoices";

const columnSchema = z.enum(
  SUPPLIER_INVOICE_COLUMN_KEYS as [SupplierInvoiceColumn, ...SupplierInvoiceColumn[]],
);
const forbidden = {
  error: {
    code: "FORBIDDEN" as const,
    message: "Not allowed to read supplier invoices",
    retryable: false,
  },
};
const listOptions = z.object({ query: listQuerySchema, groupId: uuid.optional() });

// --- reads (the accountant may read) ---

export const listSupplierInvoicesAction = authedAction
  .schema(listOptions)
  .metadata({ name: "listSupplierInvoices" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return {
      data: await listSupplierInvoices(ctx.tx, parsedInput.query, { groupId: parsedInput.groupId }),
    };
  });

export const distinctSupplierInvoicesAction = authedAction
  .schema(listOptions.extend({ column: columnSchema }))
  .metadata({ name: "distinctSupplierInvoices" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return {
      data: await distinctSupplierInvoiceValues(ctx.tx, parsedInput.column, parsedInput.query, {
        groupId: parsedInput.groupId,
      }),
    };
  });

export const supplierInvoiceDateHierarchyAction = authedAction
  .schema(listOptions.extend({ column: columnSchema }))
  .metadata({ name: "supplierInvoiceDateHierarchy" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return {
      data: await supplierInvoiceDateHierarchy(ctx.tx, parsedInput.column, parsedInput.query, {
        groupId: parsedInput.groupId,
      }),
    };
  });

export const getSupplierInvoiceAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "getSupplierInvoice" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    const r = await getSupplierInvoiceDetail(ctx.tx, ctx.callerIdentity, parsedInput.id);
    return r.error ? { error: r.error } : { data: toSupplierInvoiceDetailWire(r.data) };
  });

export const supplierInvoiceKpisAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "supplierInvoiceKpis" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return { data: await kpis(ctx.tx) };
  });

export const payableTransactionsAction = authedAction
  .schema(z.object({ currency: z.string().length(3).optional() }))
  .metadata({ name: "payableTransactions" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return { data: await payableTransactions(ctx.tx, parsedInput.currency) };
  });

export const supplierOptionsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "supplierOptions" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return { data: await supplierOptions(ctx.tx) };
  });

export const supplierInvoiceCandidateDocumentsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "supplierInvoiceCandidateDocuments" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return { data: await candidateDocuments(ctx.tx, ctx.callerIdentity) };
  });

export const copyLastSupplierInvoiceAction = authedAction
  .schema(z.object({ partnerId: uuid }))
  .metadata({ name: "copyLastSupplierInvoice" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return copyLastPrefill(ctx.tx, parsedInput.partnerId);
  });

export const inputVatForPeriodAction = authedAction
  .schema(z.object({ registrationId: uuid, from: isoDate, to: isoDate }))
  .metadata({ name: "inputVatForPeriod" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "supplier_invoice")) return forbidden;
    return { data: await inputVatForPeriod(ctx.tx, parsedInput) };
  });

// --- writes (owner only) ---

/** The entity duplicate check before "Make it a supplier invoice" (specs/documents US3): owner only, read-only. */
export const checkSupplierInvoiceDuplicatesAction = ownerAction
  .schema(
    z.object({
      documentId: uuid.optional(),
      partnerId: uuid.nullable().optional(),
      invoiceNumber: z.string().max(100).nullable().optional(),
      amount: z.string().max(20).nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
    }),
  )
  .metadata({ name: "checkSupplierInvoiceDuplicates" })
  .action(async ({ ctx, parsedInput }) => ({
    data: await findSupplierInvoiceDuplicates(ctx.tx, parsedInput),
  }));

export const createSupplierInvoiceAction = ownerAction
  .schema(service.supplierInvoiceInputSchema)
  .metadata({ name: "createSupplierInvoice" })
  .action(async ({ ctx, parsedInput }) =>
    service.createSupplierInvoice(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const updateSupplierInvoiceAction = ownerAction
  .schema(z.object({ id: uuid, data: service.updateSupplierInvoiceSchema }))
  .metadata({ name: "updateSupplierInvoice" })
  .action(async ({ ctx, parsedInput }) =>
    service.updateSupplierInvoice(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
      parsedInput.data,
    ),
  );

export const deleteSupplierInvoiceAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteSupplierInvoice" })
  .action(async ({ ctx, parsedInput }) =>
    service.deleteSupplierInvoice(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

export const cancelSupplierInvoiceAction = ownerAction
  .schema(z.object({ id: uuid, reason: z.string().trim().min(1).max(500) }))
  .metadata({ name: "cancelSupplierInvoice" })
  .action(async ({ ctx, parsedInput }) =>
    service.cancelSupplierInvoice(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
      parsedInput.reason,
    ),
  );

export const uncancelSupplierInvoiceAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "uncancelSupplierInvoice" })
  .action(async ({ ctx, parsedInput }) =>
    service.uncancelSupplierInvoice(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

export const recordSupplierPaymentAction = ownerAction
  .schema(payments.recordPaymentSchema)
  .metadata({ name: "recordSupplierPayment" })
  .action(async ({ ctx, parsedInput }) =>
    payments.recordPayment(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const removeSupplierPaymentAction = ownerAction
  .schema(z.object({ invoiceId: uuid, linkId: uuid }))
  .metadata({ name: "removeSupplierPayment" })
  .action(async ({ ctx, parsedInput }) =>
    payments.removePayment(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );
