// DTOs of the supplier-invoices module (specs/supplier-invoices/spec.md). Prisma types never leave the module.

export const SUPPLIER_INVOICE_RATE_SOURCES = [
  "same_currency",
  "ecb_daily",
  "ecb_nearest",
  "bank",
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
  paidAmount: string | null;
  paidCurrency: string | null;
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
  paidAmount: string | null;
  paidCurrency: string | null;
  basCode: string;
  basLabel: string;
  alias: string;
  vatRegistrationId: string | null;
  status: SupplierInvoiceStatus;
  /** Σ justifies allocations, in the linkable's currency */
  allocated: string;
  open: string;
  documentMissing: boolean;
  hasDocument: boolean;
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
