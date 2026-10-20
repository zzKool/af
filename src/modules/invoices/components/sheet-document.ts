// Builds what the sheet prints from an invoice DTO. Issued documents print their stored snapshot
// (`printedParties`); drafts print the live parties the page resolved. Pure — used by the print route, the
// editor and the tests.
import type { InvoiceDto, PrintedParties } from "../types";
import type { VatTreatment } from "../vat-treatment";
import type { SheetDocument } from "./invoice-sheet";

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function toSheetDocument(
  invoice: InvoiceDto,
  opts: {
    parties: PrintedParties;
    treatment: VatTreatment;
    numberHint?: string | null;
    relatedNumber?: string | null;
  },
): SheetDocument {
  return {
    type: invoice.type,
    status: invoice.status,
    number: invoice.number,
    numberHint: opts.numberHint ?? null,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    periodLabel: invoice.periodLabel,
    currency: invoice.currency,
    language: invoice.language,
    printedReferences: invoice.printedReferences,
    parties: invoice.printedParties ?? opts.parties,
    relatedNumber: opts.relatedNumber ?? null,
    notes: invoice.notes,
    paymentTermsText: invoice.paymentTermsText,
    paymentTermsDays: invoice.dueDate ? daysBetween(invoice.issueDate, invoice.dueDate) : null,
    discountPercent: invoice.discountPercent,
    lines: invoice.lines.map((l) => ({
      key: l.id,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      netAmount: l.netAmount,
    })),
    subtotal: invoice.subtotal,
    discountAmount: invoice.discountAmount,
    netAmount: invoice.netAmount,
    vatByRate: invoice.vatByRate,
    vatAmount: invoice.vatAmount,
    totalAmount: invoice.totalAmount,
    treatment: opts.treatment,
  };
}
