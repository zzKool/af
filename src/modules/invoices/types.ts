// Public DTOs of the invoices module. Plain types only — never Prisma types (constitution §2).
// Money crosses the surface as decimal strings ("25944.00"); calendar dates as ISO `YYYY-MM-DD` strings
// (the question is always "which day", never "which instant"); timestamps stay Date.

import type { RateUnit } from "@/modules/contracts";

export type InvoiceType = "quote" | "invoice" | "credit_note";
export const INVOICE_TYPES: readonly InvoiceType[] = ["quote", "invoice", "credit_note"];

/** Hand-set facts only. Everything else about "where is this document" is derived (InvoiceState). */
export type InvoiceStatus = "draft" | "issued" | "sent" | "accepted" | "declined";
export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "issued",
  "sent",
  "accepted",
  "declined",
];

/**
 * The derived state shown everywhere (list chips, filters, the sheet). Computed from the typed status, the
 * links' allocations, the credit notes, the quote decision and today — never stored.
 */
export type InvoiceState =
  | "draft"
  | "issued"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "credited"
  | "accepted"
  | "declined"
  | "expired"
  | "converted";
export const INVOICE_STATES: readonly InvoiceState[] = [
  "draft",
  "issued",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "credited",
  "accepted",
  "declined",
  "expired",
  "converted",
];

export type PrintedReference = { label: string; value: string };

export type PrintedAddress = {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
};

/** Snapshot taken at issue of everything the document prints about the two parties. */
export type PrintedParties = {
  tenant: {
    name: string;
    orgNumber: string | null;
    address: string | null;
    email: string | null;
    website: string | null;
    logoUrl: string | null;
    vatNumber: string | null;
    vatCountry: string | null;
  };
  partner: {
    name: string;
    address: PrintedAddress | null;
    vatNumber: string | null;
    orgNumber: string | null;
    email: string | null;
  };
  bank: {
    bankName: string | null;
    accountHolder: string | null;
    iban: string | null;
    bic: string | null;
    accountNumber: string | null;
    currency: string;
  } | null;
};

export type VatByRate = { rate: string; base: string; vat: string };

export type InvoiceLineDto = {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unit: RateUnit;
  unitPrice: string;
  discountPercent: string | null;
  discountAmount: string;
  netAmount: string;
  vatRate: string;
  vatAmount: string;
  periodStart: string | null;
  periodEnd: string | null;
  rateSourceId: string | null;
};

export type InvoiceDto = {
  id: string;
  tenantId: string;
  type: InvoiceType;
  status: InvoiceStatus;
  number: string | null;
  partnerId: string;
  contractId: string | null;
  vatRegistrationId: string | null;
  relatedInvoiceId: string | null;
  issueDate: string;
  /** invoices / credit notes: due date; quotes: valid until */
  dueDate: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  language: string;
  printedReferences: PrintedReference[];
  printedParties: PrintedParties | null;
  notes: string | null;
  internalNote: string | null;
  paymentTermsText: string | null;
  discountPercent: string | null;
  subtotal: string;
  discountAmount: string;
  netAmount: string;
  vatAmount: string;
  totalAmount: string;
  vatByRate: VatByRate[];
  baseCurrency: string;
  rateToBase: string | null;
  rateSource: string | null;
  rateDate: string | null;
  subtotalBase: string | null;
  vatBase: string | null;
  totalBase: string | null;
  declarationPeriod: string | null;
  pdfDocumentId: string | null;
  issuedAt: Date | null;
  sentAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
  lines: InvoiceLineDto[];
};

/** What the read model adds on top of the row: the derived state and the money still open. */
export type InvoiceDerived = {
  state: InvoiceState;
  /** Σ link allocations (bank transactions justifying this document), decimal string */
  allocated: string;
  /** total − allocated, never below 0 */
  remaining: string;
  /** Σ totals of issued credit notes referencing this invoice */
  credited: string;
  /** for a quote: the number of the invoice it became (when that invoice is issued) */
  convertedTo: string | null;
};

export type InvoiceWithDerived = InvoiceDto & InvoiceDerived;

/** Compact row for lists, pickers and the dashboard (dates as ISO strings, money as strings). */
export type InvoiceListRow = {
  id: string;
  type: InvoiceType;
  status: InvoiceStatus;
  state: InvoiceState;
  number: string | null;
  partnerId: string;
  partnerName: string;
  contractId: string | null;
  issueDate: string;
  dueDate: string | null;
  periodLabel: string | null;
  currency: string;
  language: string;
  totalAmount: string;
  totalBase: string | null;
  allocated: string;
  remaining: string;
  credited: string;
  declarationPeriod: string | null;
  issuedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
