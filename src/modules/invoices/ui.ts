// Client surface of the module: server actions (client-safe references) and DTO types. Components arrive
// with part 2 (they import ./totals internally for live figures). Never re-export services from here.

export { InvoiceActions } from "./components/invoice-actions";
export {
  type DetailsInvoice,
  InvoiceDetails,
  type RelatedDocument,
} from "./components/invoice-details";
export { type EditorInvoice, InvoiceEditor } from "./components/invoice-editor";
export { InvoiceLinks } from "./components/invoice-links";
export type { SheetDocument, SheetLine, SheetSlots } from "./components/invoice-sheet";
export { InvoiceSheet, sheetDate, sheetMoney, sheetQuantity } from "./components/invoice-sheet";
export { InvoiceStateLabel } from "./components/invoice-state-label";
export { type InvoiceRow, InvoiceTable } from "./components/invoice-table";
export { NewDocumentButton } from "./components/new-document-button";
export { type ClientOption, NewInvoiceForm } from "./components/new-invoice-form";
export { daysBetween, toSheetDocument } from "./components/sheet-document";
export * from "./invoices.actions";
export type * from "./types";
export { INVOICE_STATES, INVOICE_STATUSES, INVOICE_TYPES } from "./types";
