// The owner's categorisations by hand per partner (F125 PR 2): rows he gave a partner and an account himself — a
// rule's or a proposal's never count (they would teach the history what it already proposes).
import type { TransactionClient } from "@/kernel/db/tenant-client";

export async function partnerBasUsage(
  tx: TransactionClient,
): Promise<{ partnerId: string; basCode: string; count: number }[]> {
  const rows = await tx.bankTransaction.groupBy({
    by: ["partnerId", "basCode"],
    where: { partnerId: { not: null }, basCode: { not: null }, categorisedBy: "manual" },
    _count: { _all: true },
  });
  return rows.flatMap((r) =>
    r.partnerId && r.basCode
      ? [{ partnerId: r.partnerId, basCode: r.basCode, count: r._count._all }]
      : [],
  );
}
