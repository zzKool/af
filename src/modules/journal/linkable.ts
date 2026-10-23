import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

/**
 * Only manual entries are link endpoints (FR-004): a prepaid service justified by its document. A bank entry is
 * reached through its transaction — were it an endpoint too, the same bank movement could be allocated twice, once
 * from each (the R19 source cap counts each `from` alone). So `exists` answers false for a bank entry and
 * `createLink` refuses it (`NOT_FOUND` — not a link endpoint).
 */
export const journalEntryLinkable: Linkable = {
  type: "journal_entry",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.journalEntry.count({ where: { id, sourceType: "manual" } })) > 0;
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
