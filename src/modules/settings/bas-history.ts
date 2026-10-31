// The owner's own history of BAS accounts per partner (F125 PR 2): what the entries of each module carry, merged —
// the picker's *used before for this supplier* suggestions. Pure; each module counts its own table.
import type { BasProposalHint, BasSuggestion } from "./types";

export type PartnerBasUsage = { partnerId: string; basCode: string; count: number };

/** Per partner, the accounts used, most used first (ties by code), at most `limit` each. */
export function mergeBasUsage(
  lists: readonly (readonly PartnerBasUsage[])[],
  limit = 3,
): Record<string, { code: string; count: number }[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const list of lists)
    for (const u of list) {
      const m = counts.get(u.partnerId) ?? new Map<string, number>();
      m.set(u.basCode, (m.get(u.basCode) ?? 0) + u.count);
      counts.set(u.partnerId, m);
    }
  const out: Record<string, { code: string; count: number }[]> = {};
  for (const [partnerId, m] of counts)
    out[partnerId] = [...m]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, limit);
  return out;
}

/** A partner's history as the picker's suggestions — its default first when it has one, then what was used. */
export function partnerBasSuggestions(input: {
  defaultCode?: string | null;
  history?: readonly { code: string; count: number }[];
  /** "used {count}× before for {name}" */
  historyReason?: (count: number) => string;
}): BasSuggestion[] {
  const out: BasSuggestion[] = [];
  if (input.defaultCode) out.push({ code: input.defaultCode, source: "partner" });
  for (const h of input.history ?? [])
    out.push({
      code: h.code,
      source: "history",
      ...(input.historyReason ? { reason: input.historyReason(h.count) } : {}),
    });
  return out;
}

/** F126: a document's AI proposal as the picker's first suggestion — empty without one. */
export function aiSuggestion(hint: BasProposalHint | null | undefined): BasSuggestion[] {
  if (!hint) return [];
  return [{ code: hint.code, source: "model", ...(hint.reason ? { reason: hint.reason } : {}) }];
}
