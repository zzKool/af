import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

/** Contracts are link targets (contract PDFs, NDAs belong to them); they carry no amount. */
export const contractLinkable: Linkable = {
  type: "contract",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.contract.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const c = await tx.contract.findUnique({ where: { id }, select: { id: true, name: true } });
    return c ? { type: "contract", id: c.id, label: c.name, amount: null, currency: null } : null;
  },
};
