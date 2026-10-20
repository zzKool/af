import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

/**
 * An expense carries what the company paid for it: the bank row's amount once attached (company-paid), else the
 * receipt's amount in its currency. A bank row justifies it (allocation = the paid amount); a document is what it
 * was created from. Private expenses are refunded through settlements, not links.
 */
export const expenseLinkable: Linkable = {
  type: "expense",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.expense.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const e = await tx.expense.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        date: true,
        description: true,
        amount: true,
        currency: true,
        paidAmount: true,
        paidCurrency: true,
      },
    });
    if (!e) return null;
    const amount = e.paidAmount ?? e.amount;
    const currency = e.paidCurrency ?? e.currency;
    return {
      type: "expense",
      id: e.id,
      label: `${e.key} · ${e.date.toISOString().slice(0, 10)} · ${e.amount.toFixed(2)} ${e.currency} · ${e.description}`,
      amount: amount.toFixed(2),
      currency,
    };
  },
};

/** A settlement carries |the refund amount| in the refund currency; the refund's bank row `settles` it. */
export const settlementLinkable: Linkable = {
  type: "settlement",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.settlement.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const s = await tx.settlement.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        refundAmount: true,
        refundCurrency: true,
        allocatedBase: true,
        status: true,
      },
    });
    if (!s) return null;
    return {
      type: "settlement",
      id: s.id,
      label: `${s.number} · ${s.refundAmount.abs().toFixed(2)} ${s.refundCurrency} · ${s.allocatedBase.toFixed(2)} SEK settled${s.status === "cancelled" ? " · cancelled" : ""}`,
      amount: s.refundAmount.abs().toFixed(2),
      currency: s.refundCurrency,
    };
  },
};
