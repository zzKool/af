import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

/**
 * A bank transaction carries |amount| in its currency: it justifies invoices / documents / expenses with
 * allocations (never more than its amount — the linking service checks the source side too), pairs with
 * another transaction (`transfer`) or settles a reimbursement.
 */
export const bankTransactionLinkable: Linkable = {
  type: "bank_transaction",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.bankTransaction.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const t = await tx.bankTransaction.findUnique({
      where: { id },
      select: { id: true, bookingDate: true, amount: true, currency: true, description: true },
    });
    if (!t) return null;
    return {
      type: "bank_transaction",
      id: t.id,
      label: `${t.bookingDate.toISOString().slice(0, 10)} · ${t.amount.toFixed(2)} ${t.currency} · ${t.description}`,
      amount: t.amount.abs().toFixed(2),
      currency: t.currency,
    };
  },
};
