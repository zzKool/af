// Row → DTO, and the one way the writes load a document (with its lines).
import type { Prisma } from "@/generated/prisma/browser";
import type { Invoice, InvoiceLine } from "@/generated/prisma/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { parsePrintedParties, parsePrintedReferences, parseVatByRate } from "./json-columns";
import type { InvoiceDto, InvoiceLineDto } from "./types";

type Dec = InstanceType<typeof Prisma.Decimal>;

// --- DTO mapping ---

export const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const str = (d: Dec | null): string | null => (d ? d.toFixed(2) : null);

export function toLineDto(row: InvoiceLine): InvoiceLineDto {
  return {
    id: row.id,
    lineNo: row.lineNo,
    description: row.description,
    quantity: row.quantity.toString(),
    unit: row.unit,
    unitPrice: row.unitPrice.toFixed(2),
    discountPercent: row.discountPercent ? row.discountPercent.toString() : null,
    discountAmount: row.discountAmount.toFixed(2),
    netAmount: row.netAmount.toFixed(2),
    vatRate: row.vatRate.toString(),
    vatAmount: row.vatAmount.toFixed(2),
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    rateSourceId: row.rateSourceId,
  };
}

export function toInvoiceDto(row: Invoice & { lines: InvoiceLine[] }): InvoiceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    status: row.status,
    number: row.number,
    partnerId: row.partnerId,
    contractId: row.contractId,
    vatRegistrationId: row.vatRegistrationId,
    relatedInvoiceId: row.relatedInvoiceId,
    issueDate: iso(row.issueDate) as string,
    dueDate: iso(row.dueDate),
    periodLabel: row.periodLabel,
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    currency: row.currency,
    language: row.language,
    printedReferences: parsePrintedReferences(row.printedReferences),
    printedParties: parsePrintedParties(row.printedParties),
    notes: row.notes,
    internalNote: row.internalNote,
    paymentTermsText: row.paymentTermsText,
    discountPercent: row.discountPercent ? row.discountPercent.toString() : null,
    subtotal: row.subtotal.toFixed(2),
    discountAmount: row.discountAmount.toFixed(2),
    netAmount: row.netAmount.toFixed(2),
    vatAmount: row.vatAmount.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    vatByRate: parseVatByRate(row.vatByRate),
    baseCurrency: row.baseCurrency,
    rateToBase: row.rateToBase ? row.rateToBase.toString() : null,
    rateSource: row.rateSource,
    rateDate: iso(row.rateDate),
    subtotalBase: str(row.subtotalBase),
    vatBase: str(row.vatBase),
    totalBase: str(row.totalBase),
    declarationPeriod: row.declarationPeriod,
    pdfDocumentId: row.pdfDocumentId,
    issuedAt: row.issuedAt,
    sentAt: row.sentAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
    lines: [...row.lines].sort((a, b) => a.lineNo - b.lineNo).map(toLineDto),
  };
}

export const withLines = { lines: true } as const;

export async function load(tx: TransactionClient, id: string) {
  return tx.invoice.findUnique({ where: { id }, include: withLines });
}
