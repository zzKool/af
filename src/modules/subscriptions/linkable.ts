// The subscription as a link endpoint (F94 FR-006): the `to` side of `occurrence_of`. It allocates nothing, so its
// summary carries no amount; the label is the subscription's name and cadence (the price joins it with PR3's DTO).
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

export const subscriptionLinkable: Linkable = {
  type: "subscription",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.subscription.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const s = await tx.subscription.findUnique({
      where: { id },
      select: { id: true, name: true, cadence: true },
    });
    if (!s) return null;
    return {
      type: "subscription",
      id: s.id,
      label: `${s.name} · ${s.cadence}`,
      amount: null,
      currency: null,
    };
  },
};
