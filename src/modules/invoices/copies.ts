// New drafts from an existing document: quote → invoice, copy of anything, credit note of an invoice.
import type { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { Invoice, InvoiceLine } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import * as contracts from "@/modules/contracts";
import {
  dueDateFor,
  lineRowsFrom,
  linesToInput,
  QUOTE_VALIDITY_DAYS,
  totalsData,
} from "./defaults";
import { iso, load, toDate, toInvoiceDto, withLines } from "./dto";
import { invalid, notFound, parseError, violation } from "./errors";
import { type CreditNoteInput, creditNoteSchema, type lineInputSchema } from "./schemas";
import type { InvoiceDto, InvoiceType } from "./types";

const D = Prisma.Decimal;

// --- writes: copies ---

/** A new invoice draft from an issued (or accepted) quote, remembering its source. */
export async function convertQuote(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  today: string,
  id: string,
): Promise<ServiceResult<InvoiceDto>> {
  const row = await load(tx, id);
  if (!row) return { error: notFound("Quote", id) };
  if (row.type !== "quote") return { error: violation("Only quotes are converted") };
  if (row.status === "draft" || row.status === "declined")
    return { error: violation(`A ${row.status} quote cannot be converted`) };
  const existing = await tx.invoice.findFirst({
    where: { relatedInvoiceId: id, type: "invoice" },
    select: { id: true, number: true, status: true },
  });
  if (existing)
    return {
      error: violation(`${row.number} was already converted (${existing.number ?? "draft"})`, {
        invoiceId: existing.id,
      }),
    };
  const contract = row.contractId ? (await contracts.getContract(tx, row.contractId)).data : null;
  return copyInternal(tx, caller, audit, row, {
    type: "invoice",
    relatedInvoiceId: id,
    issueDate: today,
    dueDate: dueDateFor(today, contract?.paymentTerms),
    event: "convert",
  });
}

/** Any document as a fresh draft of the same kind (credit notes copy as invoices), unrelated to the source. */
export async function copyToDraft(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  today: string,
  id: string,
): Promise<ServiceResult<InvoiceDto>> {
  const row = await load(tx, id);
  if (!row) return { error: notFound("Invoice", id) };
  const type: InvoiceType = row.type === "credit_note" ? "invoice" : row.type;
  const contract = row.contractId ? (await contracts.getContract(tx, row.contractId)).data : null;
  return copyInternal(tx, caller, audit, row, {
    type,
    relatedInvoiceId: null,
    issueDate: today,
    dueDate:
      type === "quote"
        ? addDays(today, QUOTE_VALIDITY_DAYS)
        : dueDateFor(today, contract?.paymentTerms),
    event: "copy",
  });
}

async function copyInternal(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  source: Invoice & { lines: InvoiceLine[] },
  opts: {
    type: InvoiceType;
    relatedInvoiceId: string | null;
    issueDate: string;
    dueDate: string | null;
    event: string;
    lines?: z.output<typeof lineInputSchema>[];
    internalNote?: string;
  },
): Promise<ServiceResult<InvoiceDto>> {
  const lines = opts.lines ?? linesToInput(source.lines);
  const lineRows = lineRowsFrom(caller.tenantId, lines);
  if (!Array.isArray(lineRows)) return { error: lineRows };
  const discountPercent = source.discountPercent ? source.discountPercent.toString() : null;
  const created = await tx.invoice.create({
    data: {
      tenantId: caller.tenantId,
      type: opts.type,
      status: "draft",
      partnerId: source.partnerId,
      contractId: source.contractId,
      vatRegistrationId: source.vatRegistrationId,
      relatedInvoiceId: opts.relatedInvoiceId,
      issueDate: toDate(opts.issueDate),
      dueDate: opts.dueDate ? toDate(opts.dueDate) : null,
      periodLabel: source.periodLabel,
      periodStart: source.periodStart,
      periodEnd: source.periodEnd,
      currency: source.currency,
      language: source.language,
      printedReferences: source.printedReferences as Prisma.InputJsonValue,
      notes: source.notes,
      internalNote: opts.internalNote ?? source.internalNote,
      paymentTermsText: source.paymentTermsText,
      discountPercent: source.discountPercent,
      ...totalsData(lines, discountPercent),
      baseCurrency: source.baseCurrency,
      createdBy: caller.userId,
      source: caller.source,
      lines: { createMany: { data: lineRows } },
    },
    include: withLines,
  });
  const dto = toInvoiceDto(created);
  await audit.log({
    action: "create",
    entityType: "invoice",
    entityId: created.id,
    newData: toAuditData({ ...dto, event: opts.event, sourceId: source.id }),
  });
  return { data: dto };
}

/**
 * A credit-note draft from an issued invoice: all lines in full, or the given lines with the quantity to
 * credit (a percent discount follows; a fixed discount is scaled by quantity). Issued like an invoice.
 */
export async function createCreditNote(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  today: string,
  input: CreditNoteInput,
): Promise<ServiceResult<InvoiceDto>> {
  const parsed = creditNoteSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const original = await load(tx, parsed.data.originalId);
  if (!original) return { error: notFound("Invoice", parsed.data.originalId) };
  if (original.type !== "invoice") return { error: violation("Only invoices are credited") };
  if (original.status === "draft")
    return { error: violation("Only issued invoices can be credited") };

  const wanted = parsed.data.lines;
  const sourceLines = [...original.lines].sort((a, b) => a.lineNo - b.lineNo);
  const lines: z.output<typeof lineInputSchema>[] = [];
  for (const l of sourceLines) {
    const pick = wanted
      ? wanted.find((w) => w.lineId === l.id)
      : { quantity: l.quantity.toString() };
    if (!pick) continue;
    const qty = new D(pick.quantity);
    if (qty.lte(0) || qty.gt(l.quantity))
      return {
        error: invalid(`Line ${l.lineNo}: credit quantity must be between 0 and ${l.quantity}`),
      };
    const ratio = l.quantity.isZero() ? new D(0) : qty.div(l.quantity);
    lines.push({
      description: `Credit: ${l.description}`,
      quantity: qty.toString(),
      unit: l.unit,
      unitPrice: l.unitPrice.toFixed(2),
      discountPercent: l.discountPercent ? l.discountPercent.toString() : null,
      discountFixed:
        l.discountPercent || l.discountAmount.isZero()
          ? null
          : l.discountAmount.mul(ratio).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
      vatRate: l.vatRate.toString(),
      periodStart: iso(l.periodStart),
      periodEnd: iso(l.periodEnd),
      rateSourceId: l.rateSourceId,
    });
  }
  if (wanted && lines.length !== wanted.length)
    return { error: invalid("A credited line does not belong to the invoice") };
  if (lines.length === 0) return { error: invalid("Nothing to credit") };

  return copyInternal(tx, caller, audit, original, {
    type: "credit_note",
    relatedInvoiceId: original.id,
    issueDate: today,
    dueDate: today,
    event: "credit_note",
    lines,
    internalNote: `Credit note for ${original.number}`,
  });
}
