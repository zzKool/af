import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";
import * as partners from "@/modules/partners";

/**
 * A supplier invoice carries what the company owes for it: the bank row's amount once a cross-currency payment is
 * attached (`paid_amount / paid_currency`, D-g), else the invoice total in its currency. Bank rows `justify` it —
 * the allocations are the payments; a document is what it was created from.
 */
export const supplierInvoiceLinkable: Linkable = {
  type: "supplier_invoice",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.supplierInvoice.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const si = await tx.supplierInvoice.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        partnerId: true,
        invoiceNumber: true,
        amountTotal: true,
        currency: true,
        paidAmount: true,
        paidCurrency: true,
        cancelled: true,
      },
    });
    if (!si) return null;
    const names = await partners.partnerNames(tx, [si.partnerId]);
    const amount = si.paidAmount ?? si.amountTotal;
    const currency = si.paidCurrency ?? si.currency;
    return {
      type: "supplier_invoice",
      id: si.id,
      label: `${si.key} · ${names.get(si.partnerId) ?? "?"} · ${si.invoiceNumber} · ${si.amountTotal.toFixed(2)} ${si.currency}${si.cancelled ? " · cancelled" : ""}`,
      amount: amount.toFixed(2),
      currency,
    };
  },
};
