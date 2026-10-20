import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

/**
 * Manual journal entries carry an amount and can be the `from` of a `justifies` link (a prepaid service justified
 * by its document). Bank entries are reached through their transaction and are not offered here.
 */
export const journalEntryLinkable: Linkable = {
  type: "journal_entry",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.journalEntry.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const e = await tx.journalEntry.findUnique({
      where: { id },
      select: { id: true, entryDate: true, description: true, amount: true, currency: true },
    });
    if (!e) return null;
    const amount = e.amount.abs().toFixed(2);
    return {
      type: "journal_entry",
      id: e.id,
      label: `${e.entryDate.toISOString().slice(0, 10)} · ${e.amount.toFixed(2)} ${e.currency} · ${e.description}`,
      amount,
      currency: e.currency,
    };
  },
};
