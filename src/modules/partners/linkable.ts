import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

/** Partners are link targets (documents and invoices belong to them); they carry no amount. */
export const partnerLinkable: Linkable = {
  type: "partner",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.partner.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const p = await tx.partner.findUnique({ where: { id }, select: { id: true, name: true } });
    return p ? { type: "partner", id: p.id, label: p.name, amount: null, currency: null } : null;
  },
};
