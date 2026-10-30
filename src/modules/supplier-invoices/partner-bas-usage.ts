// The accounts the owner's supplier invoices carry per supplier (F125 PR 2) — the picker's history.
import type { TransactionClient } from "@/kernel/db/tenant-client";

export async function partnerBasUsage(
  tx: TransactionClient,
): Promise<{ partnerId: string; basCode: string; count: number }[]> {
  const rows = await tx.supplierInvoice.groupBy({
    by: ["partnerId", "basCode"],
    _count: { _all: true },
  });
  return rows.map((r) => ({ partnerId: r.partnerId, basCode: r.basCode, count: r._count._all }));
}
