// Row → DTO, and `iso` (a date column → yyyy-mm-dd) the writes share.
import type { SupplierInvoice, SupplierInvoiceLine } from "@/generated/prisma/client";
import type {
  SupplierInvoiceDto,
  SupplierInvoiceLineDto,
  SupplierInvoiceRateSource,
} from "./types";

// --- DTO mapping ---

export const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function toLineDto(l: SupplierInvoiceLine): SupplierInvoiceLineDto {
  return {
    id: l.id,
    lineNo: l.lineNo,
    description: l.description,
    amountNet: l.amountNet.toFixed(2),
    vatRate: l.vatRate.toFixed(2),
    vatAmount: l.vatAmount.toFixed(2),
    basCode: l.basCode,
  };
}

export function toSupplierInvoiceDto(
  row: SupplierInvoice & { lines?: SupplierInvoiceLine[] },
): SupplierInvoiceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    groupId: row.groupId,
    key: row.key,
    seq: row.seq,
    alias: row.alias,
    partnerId: row.partnerId,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: iso(row.invoiceDate) ?? "",
    dueDate: iso(row.dueDate) ?? "",
    dueDateDefaulted: row.dueDateDefaulted,
    currency: row.currency,
    amountNet: row.amountNet.toFixed(2),
    vatAmount: row.vatAmount.toFixed(2),
    amountTotal: row.amountTotal.toFixed(2),
    amountBase: row.amountBase.toFixed(2),
    rate: row.rate.toString(),
    rateSource: row.rateSource as SupplierInvoiceRateSource,
    rateDate: iso(row.rateDate),
    paidAmount: row.paidAmount ? row.paidAmount.toFixed(2) : null,
    paidCurrency: row.paidCurrency,
    basCode: row.basCode,
    vatRegistrationId: row.vatRegistrationId,
    documentMissing: row.documentMissing,
    note: row.note,
    cancelled: row.cancelled,
    cancelledReason: row.cancelledReason,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
    lines: (row.lines ?? []).map(toLineDto).sort((a, b) => a.lineNo - b.lineNo),
  };
}
