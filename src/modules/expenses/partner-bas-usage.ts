// The accounts the owner's expenses carry per partner (F125 PR 2) — the picker's history.
import type { TransactionClient } from "@/kernel/db/tenant-client";

export async function partnerBasUsage(
  tx: TransactionClient,
): Promise<{ partnerId: string; basCode: string; count: number }[]> {
  const rows = await tx.expense.groupBy({
    by: ["partnerId", "basCode"],
    where: { partnerId: { not: null } },
    _count: { _all: true },
  });
  return rows.flatMap((r) =>
    r.partnerId ? [{ partnerId: r.partnerId, basCode: r.basCode, count: r._count._all }] : [],
  );
}
