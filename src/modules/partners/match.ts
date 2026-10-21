// The supplier match (specs/documents US1, harvest R39): the OCR's vendor name / VAT number / address against the
// tenant's partners. Pure scoring on the harvest's weights, one query over the active partners (a solo company has
// dozens), the best five with their confidence; the card shows a *best match* from 60 %.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { MatchablePartner, MatchQuery, PartnerMatch } from "./types";

export const MATCH_WEIGHTS = {
  vatExact: 100,
  nameExact: 80,
  nameContains: 60,
  nameNearBase: 40, // − 10 per edit, up to 3 edits
  addressContains: 20,
  typeMatch: 10,
} as const;
export const MATCH_SCORE_SCALE = 140;
export const BEST_MATCH_PERCENT = 60;
export const MATCH_LIMIT = 5;

export type { MatchablePartner, MatchQuery, PartnerMatch };

const fold = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const alnum = (s: string | null | undefined) => fold(s).replace(/[^a-z0-9]/g, "");

/** Levenshtein distance capped early: anything above `max` returns max + 1. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** The harvest's score: VAT exact 100 · name exact 80 | contains 60 | ≤ 3 edits 40 − 10·d · address contains 20 · type 10. */
export function scorePartnerMatch(query: MatchQuery, partner: MatchablePartner): number {
  let score = 0;
  const qVat = alnum(query.vatNumber);
  if (qVat && qVat === alnum(partner.vatNumber)) score += MATCH_WEIGHTS.vatExact;

  const qName = fold(query.name);
  const pName = fold(partner.name);
  if (qName && pName) {
    if (qName === pName) score += MATCH_WEIGHTS.nameExact;
    else if (pName.includes(qName) || qName.includes(pName)) score += MATCH_WEIGHTS.nameContains;
    else {
      const d = editDistance(qName, pName);
      if (d <= 3) score += MATCH_WEIGHTS.nameNearBase - 10 * d;
    }
  }

  const qAddr = fold(query.address);
  const pAddr = fold(partner.address);
  if (qAddr && pAddr && (pAddr.includes(qAddr) || qAddr.includes(pAddr))) {
    score += MATCH_WEIGHTS.addressContains;
  }

  if (query.type && partner.types.includes(query.type)) score += MATCH_WEIGHTS.typeMatch;
  return score;
}

export function matchPercent(score: number): number {
  return Math.min(100, Math.round((score / MATCH_SCORE_SCALE) * 100));
}

/** Rank the partners by score, drop the zeros, keep the best `limit`. Pure — the query layer feeds it. */
export function rankPartnerMatches(
  query: MatchQuery,
  partners: readonly MatchablePartner[],
  limit = MATCH_LIMIT,
): PartnerMatch[] {
  return partners
    .map((p) => ({ partnerId: p.id, name: p.name, score: scorePartnerMatch(query, p) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((m) => ({ ...m, percent: matchPercent(m.score) }));
}

function flattenAddress(address: unknown): string | null {
  if (!address || typeof address !== "object") return null;
  const parts = Object.values(address as Record<string, unknown>).filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return parts.length ? parts.join(", ") : null;
}

/** The active partners of the tenant scored against the OCR's vendor facts. */
export async function matchPartners(
  tx: TransactionClient,
  query: MatchQuery,
  limit = MATCH_LIMIT,
): Promise<PartnerMatch[]> {
  if (!fold(query.name) && !alnum(query.vatNumber)) return [];
  const rows = await tx.partner.findMany({
    where: { isActive: true },
    select: { id: true, name: true, vatNumber: true, address: true, types: true },
  });
  return rankPartnerMatches(
    query,
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      vatNumber: r.vatNumber,
      address: flattenAddress(r.address),
      types: r.types,
    })),
    limit,
  );
}
