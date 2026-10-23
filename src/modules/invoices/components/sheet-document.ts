// Builds what the sheet prints from an invoice DTO. Issued documents print their stored snapshot
// (`printedParties`); drafts print the live parties the page resolved. Pure — used by the print route, the
// editor and the tests.
import { daysUntil } from "@/kernel/clock/calendar";
import type { InvoiceDto, PrintedParties } from "../types";
import type { VatTreatment } from "../vat-treatment";
import type { SheetDocument } from "./invoice-sheet";

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
    paymentTermsDays: invoice.dueDate ? daysUntil(invoice.issueDate, invoice.dueDate) : null,
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
