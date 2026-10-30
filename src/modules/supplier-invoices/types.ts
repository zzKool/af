// DTOs of the supplier-invoices module (specs/supplier-invoices/spec.md). Prisma types never leave the module.

import type { BasOption } from "@/modules/settings/ui";
/** the base is written once at the invoice date — never the bank's (F114, CHECK `rate_source <> 'bank'`) */
export const SUPPLIER_INVOICE_RATE_SOURCES = [
  "same_currency",
  "ecb_daily",
  "ecb_nearest",
  "manual",
] as const;
export type SupplierInvoiceRateSource = (typeof SUPPLIER_INVOICE_RATE_SOURCES)[number];

/** Derived, never stored (FR-003); `cancelled` is the one typed flag. */
export const SUPPLIER_INVOICE_STATUSES = [
  "unpaid",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
] as const;
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number];

export type SupplierInvoiceLineDto = {
  id: string;
  lineNo: number;
  description: string;
  amountNet: string;
  vatRate: string;
  vatAmount: string;
  basCode: string;
};

export type SupplierInvoiceDto = {
  id: string;
  tenantId: string;
  groupId: string;
  key: string;
  seq: number;
  alias: string;
  partnerId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  dueDateDefaulted: boolean;
  currency: string;
  amountNet: string;
  vatAmount: string;
  amountTotal: string;
  amountBase: string;
  rate: string;
  rateSource: SupplierInvoiceRateSource;
  rateDate: string | null;
  basCode: string;
  vatRegistrationId: string | null;
  documentMissing: boolean;
  note: string | null;
  cancelled: boolean;
  cancelledReason: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
  lines: SupplierInvoiceLineDto[];
};

/** One row of the list (FR-005). */
export type SupplierInvoiceListRow = {
  id: string;
  key: string;
  groupId: string;
  groupNumber: number;
  groupDescription: string;
  partnerId: string;
  partnerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  dueDateDefaulted: boolean;
  daysOverdue: number;
  currency: string;
  amountNet: string;
  vatAmount: string;
  amountTotal: string;
  amountBase: string;
  rateSource: SupplierInvoiceRateSource;
  basCode: string;
  basLabel: string;
  alias: string;
  vatRegistrationId: string | null;
  status: SupplierInvoiceStatus;
  /** Σ justifies allocations, the invoice's currency, and what is still open */
  allocated: string;
  open: string;
  /** Σ base the rows gave; Σ base − the invoice's base for the paid share, signed (F114); "0.00" while unpaid */
  allocatedBase: string;
  fxDifference: string;
  documentMissing: boolean;
  hasDocument: boolean;
  /** made from a document that says the buyer pays the VAT (D54, F91) */
  reverseCharge: boolean;
  note: string | null;
  cancelled: boolean;
  createdAt: Date;
};

export type SupplierInvoiceKpis = {
  openBase: string;
  openCount: number;
  overdueBase: string;
  overdueCount: number;
  dueSoonBase: string;
  dueSoonCount: number;
  paidThisMonthBase: string;
  paidThisMonthCount: number;
};

export type SupplierOption = {
  id: string;
  name: string;
  defaultCurrency: string | null;
  defaultBasCategoryCode: string | null;
  paymentTermsDays: number | null;
};

// --- option lists the pages hand to the components (client-safe) ---

export type GroupOption = {
  id: string;
  number: number;
  description: string;
  kind: "trip" | "batch";
};
/** A BAS account as the pickers show it (F125) — settings' one list builder. */
export type CategoryOption = BasOption;
export type DocumentOption = { id: string; businessKey: string; fileName: string; status: string };
export type RegistrationOption = { id: string; label: string; country: string };
