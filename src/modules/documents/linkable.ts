import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { Linkable } from "@/modules/linking";

/**
 * Documents are justification targets and belong to partners/contracts. The amount a financial document
 * carries (from OCR corrections) is exposed once the review data model settles; null until then.
 */
export const documentLinkable: Linkable = {
  type: "document",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.document.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const d = await tx.document.findUnique({
      where: { id },
      select: { id: true, businessKey: true, fileName: true },
    });
    return d
      ? {
          type: "document",
          id: d.id,
          label: d.businessKey || d.fileName,
          amount: null,
          currency: null,
        }
      : null;
  },
};
