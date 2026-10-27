// The counterparty memory (F116 FR-004, D67): what the links that exist say about a counterparty key — "the rows
// of `OPENAI *CHATGPT` were linked to OpenAI 39 times". Nothing is stored: a confirmation *is* the memory (a link),
// a removed link forgets. Read per request for the keys at hand: the rows carrying them (banking's linkable), their
// allocating links (this module's table), the partners of the linked entities (each owner's linkable).
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { ALLOCATING_KINDS } from "./kinds";
import { getLinkable } from "./linkable";
import type { Memory } from "./scoring";
import type { LinkableType } from "./types";

/** The rows read per key: the latest ones say what the counterparty is now. */
export const MEMORY_ROWS_PER_KEY = 200;

/** Per counterparty key, the partners its rows were linked to, with how often. Keys nobody linked are absent. */
export async function memoryForKeys(
  tx: TransactionClient,
  keys: readonly (string | null | undefined)[],
): Promise<Map<string, Memory>> {
  const out = new Map<string, Memory>();
  const wanted = [...new Set(keys.filter((k): k is string => !!k))];
  const bank = getLinkable("bank_transaction");
  if (wanted.length === 0 || !bank?.rowsByCounterparty) return out;
  const rowsByKey = await bank.rowsByCounterparty(tx, wanted, MEMORY_ROWS_PER_KEY);
  const keyOfRow = new Map<string, string>();
  for (const [key, ids] of rowsByKey) for (const id of ids) keyOfRow.set(id, key);
  if (keyOfRow.size === 0) return out;

  const links = await tx.link.findMany({
    where: {
      fromType: "bank_transaction",
      fromId: { in: [...keyOfRow.keys()] },
      kind: { in: [...ALLOCATING_KINDS] },
    },
    select: { fromId: true, toType: true, toId: true },
  });
  // the partners of the linked entities, one read per type through its owner
  const idsByType = new Map<LinkableType, Set<string>>();
  for (const l of links) {
    const type = l.toType as LinkableType;
    idsByType.set(type, (idsByType.get(type) ?? new Set()).add(l.toId));
  }
  const partnerOf = new Map<string, { id: string; name: string }>();
  for (const [type, ids] of idsByType) {
    const linkable = getLinkable(type);
    if (!linkable?.factsMany) continue;
    for (const f of await linkable.factsMany(tx, [...ids])) {
      if (f.partnerId && f.partnerName)
        partnerOf.set(`${type}:${f.id}`, { id: f.partnerId, name: f.partnerName });
    }
  }

  const counts = new Map<string, Map<string, { name: string; count: number }>>();
  for (const l of links) {
    const key = keyOfRow.get(l.fromId);
    const partner = partnerOf.get(`${l.toType}:${l.toId}`);
    if (!key || !partner) continue;
    const perKey = counts.get(key) ?? new Map();
    const entry = perKey.get(partner.id) ?? { name: partner.name, count: 0 };
    entry.count += 1;
    perKey.set(partner.id, entry);
    counts.set(key, perKey);
  }
  for (const [key, perKey] of counts) out.set(key, perKey);
  return out;
}

/** The partners a memory remembers, most linked first — the finder fetches their open entities whatever the date. */
export function rememberedPartners(memory: Memory | undefined, limit = 3): string[] {
  if (!memory) return [];
  return [...memory.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

/** What the memory proposes for one row (the Justify panel's partner, F116 US3): its partners, most linked first. */
export async function memoryForRow(
  tx: TransactionClient,
  bankTransactionId: string,
): Promise<{ partnerId: string; name: string; count: number }[]> {
  const bank = getLinkable("bank_transaction");
  const facts = bank?.facts ? await bank.facts(tx, bankTransactionId) : null;
  const key = facts?.counterpartyKey;
  if (!key) return [];
  const memory = (await memoryForKeys(tx, [key])).get(key);
  return rememberedPartners(memory, 5).map((id) => {
    const m = memory?.get(id) ?? { name: "", count: 0 };
    return { partnerId: id, name: m.name, count: m.count };
  });
}
