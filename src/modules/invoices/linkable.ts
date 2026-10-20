import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

/** Issued invoices and credit notes carry an amount: bank transactions justify them with allocations (D18). */
export const invoiceLinkable: Linkable = {
  type: "invoice",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.invoice.count({ where: { id, status: { not: "draft" } } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const inv = await tx.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        totalAmount: true,
        currency: true,
      },
    });
    if (!inv || inv.status === "draft") return null;
    return {
      type: "invoice",
      id: inv.id,
      label: inv.number ?? inv.id,
      // quotes are not paid; invoices and credit notes carry their total
      amount: inv.type === "quote" ? null : inv.totalAmount.toFixed(2),
      currency: inv.type === "quote" ? null : inv.currency,
    };
  },
};
