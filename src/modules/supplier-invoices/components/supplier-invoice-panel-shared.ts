// What the sections of the supplier-invoice panel share: the detail as the action returns it (dates as strings),
// the patch the panel saves, and two display helpers.
import { formatMoney } from "@/kernel/money/format-money";
import type { SupplierInvoiceDetailWire } from "@/modules/supplier-invoices/detail-wire";
import type { updateSupplierInvoiceAction } from "@/modules/supplier-invoices/supplier-invoices.actions";

/** The detail as the action returns it — timestamps as ISO strings (`toSupplierInvoiceDetailWire`). */
export type SupplierInvoicePanelDetail = SupplierInvoiceDetailWire;

export type SupplierInvoicePatch = Parameters<typeof updateSupplierInvoiceAction>[0]["data"];

/** Saves a patch, toasts, reloads the panel (also on error, to put the fields back). */
export type SaveSupplierInvoice = (patch: SupplierInvoicePatch) => Promise<void>;

/** On-screen money (D40): `1 297.20 CHF` in every UI language. */
export const money = (amount: string, currency: string) => formatMoney(amount, currency);

export const NONE = "__none__";
