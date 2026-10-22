// What the sections of the supplier-invoice panel share: the detail as the action returns it (dates as strings),
// the patch the panel saves, and two display helpers.
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import type { SupplierInvoiceDetail } from "@/modules/supplier-invoices/queries";
import type { updateSupplierInvoiceAction } from "@/modules/supplier-invoices/supplier-invoices.actions";

export type SupplierInvoicePanelDetail = Omit<SupplierInvoiceDetail, "invoice" | "links"> & {
  invoice: Omit<SupplierInvoiceDetail["invoice"], "createdAt" | "updatedAt" | "cancelledAt"> & {
    createdAt: string;
    updatedAt: string;
    cancelledAt: string | null;
  };
  links: (Omit<SupplierInvoiceDetail["links"][number], "createdAt"> & { createdAt: string })[];
};

export type SupplierInvoicePatch = Parameters<typeof updateSupplierInvoiceAction>[0]["data"];

/** Saves a patch, toasts, reloads the panel (also on error, to put the fields back). */
export type SaveSupplierInvoice = (patch: SupplierInvoicePatch) => Promise<void>;

export const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

export const NONE = "__none__";
