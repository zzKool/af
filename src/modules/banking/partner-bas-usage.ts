// The owner's categorisations per partner (F125 PR 2; D82): rows he gave a partner and an account himself — by hand,
// or through the proof he justified them with (the Justify click types nothing since T028, the proof's facts are
// read derived) — a rule's or a proposal's never count (they would teach the history what it already proposes).
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { learnedRows } from "./learned";

export async function partnerBasUsage(
  tx: TransactionClient,
): Promise<{ partnerId: string; basCode: string; count: number }[]> {
  const counts = new Map<string, { partnerId: string; basCode: string; count: number }>();
  for (const r of await learnedRows(tx, {})) {
    const { partnerId, basCode } = r.learned;
    if (!partnerId || !basCode) continue;
    const key = `${partnerId}:${basCode}`;
    const hit = counts.get(key) ?? { partnerId, basCode, count: 0 };
    hit.count += 1;
    counts.set(key, hit);
  }
  return [...counts.values()];
}
