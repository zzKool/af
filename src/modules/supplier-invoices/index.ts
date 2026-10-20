// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and actions.

export { supplierInvoiceLinkable } from "./linkable";
export type { SupplierInvoicePageOptions } from "./page-data";
export { supplierInvoicePageOptions } from "./page-data";
export type { RecordPaymentInput } from "./payments";
export {
  allocatedTo,
  attachPayment,
  attachPaymentSchema,
  detachPayment,
  recordPayment,
  recordPaymentSchema,
  removePayment,
} from "./payments";
export * from "./queries";
export {
  addDays,
  DEFAULT_PAYMENT_TERMS_DAYS,
  deriveSupplierInvoiceStatus,
  openAmount,
} from "./status";
export type {
  LineInput,
  SupplierInvoiceInput,
  UpdateSupplierInvoiceInput,
} from "./supplier-invoices";
export {
  baseAmount,
  cancelSupplierInvoice,
  createSupplierInvoice,
  deleteSupplierInvoice,
  isOpen,
  lineSchema,
  supplierInvoiceInputSchema,
  uncancelSupplierInvoice,
  updateSupplierInvoice,
  updateSupplierInvoiceSchema,
} from "./supplier-invoices";
export * from "./supplier-invoices.actions";
export type * from "./types";
export { SUPPLIER_INVOICE_RATE_SOURCES, SUPPLIER_INVOICE_STATUSES } from "./types";
