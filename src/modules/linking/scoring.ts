// The one scorer (specs/linking/spec.md FR-002, harvest §4.1 / §8.1; F116 `specs/linking/one-engine.md`): a bank
// row against an entity, in either direction. Pure — Decimal strings in, a score with its reasons out; no I/O.
// Every point is a claim and every claim is true (F116 FR-002): full reference 40, partial invoice number 20,
// partner name (whole or by token) 25, *linked to this partner before* 25 (the counterparty memory — a reference,
// D67), keyword 15, amount 40 / 30 / 20 / 10 within 10 % (nothing beyond), date 30 / 25 / 15 / 5 inside the
// payment window (`window.ts`; nothing outside), currency −10 unless a reference matched. A pair whose only claim
// is its date is no suggestion. HIGH = (reference ∧ ≥ 60 ∧ amount ≤ 5 %) ∨ ≥ 80, MEDIUM ≥ 50, else LOW. A side
// whose currency is not known (null, F61-b) is never compared on the amount and never penalised.
import { Prisma } from "@/generated/prisma/client";
import { daysBetween } from "@/kernel/clock/calendar";
import type { Confidence, EntityFacts, LinkableType, MatchResult } from "./types";
import { inWindow } from "./window";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** The bank row as the scorer sees it (the signed amount is irrelevant — the finder picked the direction). */
export type RowFacts = {
  amount: string;
  /** null = not known (never for a bank row today — the type is the facts' one) */
  currency: string | null;
  amountBase: string | null;
  /** ISO booking date */
  date: string;
  /** name, message, additional details, sender, recipient, description — all of them (v1 skipped `sender`) */
  texts: string[];
};

export const WEIGHTS = {
  reference: 40,
  partialReference: 20,
  partnerName: 25,
  /** the counterparty memory: this row's counterparty was linked to the candidate's partner before (D67) */
  memory: 25,
  keyword: 15,
  amount: [40, 30, 20, 10] as const,
  date: [30, 25, 15, 5] as const,
  currencyPenalty: -10,
} as const;

/** The SEK bases may differ by this much before a cross-currency candidate is dropped (harvest R6). */
export const CROSS_CURRENCY_TOLERANCE = "0.06";
/** HIGH candidates closer than this are ambiguous for bulk apply (harvest R18). */
export const AMBIGUITY_GAP = 10;

const REFERENCE_LABEL: Record<LinkableType, string> = {
  invoice: "Invoice number in message",
  supplier_invoice: "Invoice number in message",
  expense: "Expense key in message",
  document: "Document key in message",
  bank_transaction: "Reference in message",
  partner: "Name in message",
  contract: "Reference in message",
  subscription: "Name in message",
};

const NAME_LABEL: Partial<Record<LinkableType, string>> = {
  supplier_invoice: "Supplier name match",
  invoice: "Client name match",
};

/** words too common to tell one receipt from another */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "subscription",
  "invoice",
  "payment",
  "receipt",
  "monthly",
  "yearly",
  "annual",
  "license",
  "licence",
  "service",
  "services",
  "faktura",
  "betalning",
  "kortköp",
  "abonnemang",
]);

/** Words of a company name that tell nobody apart: legal forms, connectives, trade words (en · sv · fr · de). */
const NAME_NOISE: ReadonlySet<string> = new Set([
  "aktiebolag",
  "gmbh",
  "sarl",
  "sàrl",
  "limited",
  "corp",
  "corporation",
  "company",
  "group",
  "holding",
  "international",
  "services",
  "service",
  "solutions",
  "consulting",
  "office",
  "systems",
  "technologies",
  "sweden",
  "sverige",
  "schweiz",
  "suisse",
  "switzerland",
  "europe",
  "nordic",
  "the",
  "and",
  "och",
  "und",
]);

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const words = (s: string): string[] =>
  normalise(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The tokens of a partner's name worth finding alone (F116 FR-003): ≥ 4 characters, not a legal form or a trade word. */
export function nameTokens(name: string): string[] {
  return [
    ...new Set(
      words(name).filter((w) => w.length >= 4 && !NAME_NOISE.has(w) && !GENERIC_WORDS.has(w)),
    ),
  ];
}

/**
 * A name token in the row's text: a word equal to it or starting with it (`anthropic*`), or a truncated word of
 * at least six characters it starts with (Nordea cuts `SKATTEPUNKTENS` to `SKATTEPUNK`).
 */
function tokenHit(token: string, rowWords: readonly string[]): boolean {
  return rowWords.some(
    (w) => w === token || w.startsWith(token) || (w.length >= 6 && token.startsWith(w)),
  );
}

/**
 * The tokens of a row's text that could be an entity's number (`VA26-003`, `9160`, `2026-0031`): three characters
 * or more with a digit, as written and upper-cased — what a finder looks numbers up by, whatever their date.
 */
export function referenceTokens(texts: readonly (string | null)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const raw of (t ?? "").split(/[\s,;:*()"'/]+/)) {
      const tok = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (tok.length >= 3 && /\d/.test(tok)) {
        out.add(tok);
        out.add(tok.toUpperCase());
      }
    }
  }
  return [...out];
}

/** What the counterparty memory knows about one row: per partner id, its name and how many links it got. */
export type Memory = ReadonlyMap<string, { name: string; count: number }>;

/** The tokens of an invoice number worth searching on their own: `INV-2025-042` → `042` (R11). */
export function partialTokens(reference: string): string[] {
  return reference
    .split(/[-_\s]+/)
    .map((t) => t.toLowerCase())
    .filter(
      (t) =>
        (t.length >= 3 && /^\d+$/.test(t) && !/^20\d\d$/.test(t)) ||
        (t.length > 3 && !["inv", "invoice"].includes(t) && !/^20\d\d$/.test(t)),
    );
}

/** Whole calendar days between two ISO dates — the kernel's, re-exported for the scorer's callers (audit 27). */
export { daysBetween };

/** The amount tier: 0.1 % · 1 % · 5 % · 10 %; null beyond 10 % — an amount that far off is no claim (F116 FR-002). */
export function amountTier(row: Dec, entity: Dec): number | null {
  if (entity.lte(0)) return null;
  const diff = row.minus(entity).abs().div(entity);
  if (diff.lt("0.001")) return 0;
  if (diff.lt("0.01")) return 1;
  if (diff.lt("0.05")) return 2;
  if (diff.lt("0.10")) return 3;
  return null;
}

/**
 * The date claim inside the payment window (F116 FR-002), null outside it: the same day 30 · within 2 days 25 ·
 * on the due date 30 · within the terms 15 · up to 5 days late 15 · up to 10 days late 5 · an entity dated once:
 * within 5 days 15, within 10 days 5.
 */
export function dateClaim(
  rowDate: string,
  entity: Pick<EntityFacts, "type" | "date" | "dueDate">,
): { points: number; reason: string } | null {
  if (!inWindow(rowDate, entity)) return null;
  const days = daysBetween(rowDate, entity.date);
  if (days === 0) return { points: WEIGHTS.date[0], reason: "Same date" };
  if (days <= 2) return { points: WEIGHTS.date[1], reason: "Within 2 days" };
  const due = entity.dueDate && entity.dueDate !== entity.date ? entity.dueDate : null;
  if (due) {
    if (rowDate === due) return { points: WEIGHTS.date[0], reason: "Paid on the due date" };
    if (rowDate < due) return { points: WEIGHTS.date[2], reason: "Within the terms" };
    const late = daysBetween(rowDate, due);
    return {
      points: late <= 5 ? WEIGHTS.date[2] : WEIGHTS.date[3],
      reason: `${late} days after the due date`,
    };
  }
  if (days <= 5) return { points: WEIGHTS.date[2], reason: "Within 5 days" };
  return { points: WEIGHTS.date[3], reason: `${days} days apart` };
}

const AMOUNT_REASON = [
  "Exact amount match",
  "Very close amount match",
  "Amount within tolerance",
  "Approximate amount match",
] as const;

/**
 * HIGH = score ≥ 80, or a reference with ≥ 60 — unless the amount is only approximate (> 5 % off): a client
 * name next to the wrong amount is a lead, not a match to apply in one key (v3 tightening of harvest R15).
 */
export function confidenceOf(
  score: number,
  reference: boolean,
  amountTier: number | null = null,
): Confidence {
  if (score >= 80 || (reference && score >= 60 && amountTier !== 3)) return "HIGH";
  if (score >= 50) return "MEDIUM";
  return "LOW";
}

/**
 * Score one row against one entity. `null` when the pair cannot be compared at all: different currencies,
 * no SEK base on one side and no reference in the text (harvest R6 — such candidates are dropped).
 */
export function scoreMatch(
  row: RowFacts,
  entity: EntityFacts,
  memory?: Memory,
): MatchResult | null {
  const reasons: string[] = [];
  let score = 0;
  let reference = false;
  const haystack = normalise(row.texts.filter(Boolean).join(" "));
  const rowWords = words(haystack);

  // 1. the entity's number / key in the row's text
  const ref = entity.reference ? normalise(entity.reference) : "";
  if (ref && haystack.includes(ref)) {
    score += WEIGHTS.reference;
    reasons.push(REFERENCE_LABEL[entity.type]);
    reference = true;
  } else if (ref && (entity.type === "invoice" || entity.type === "supplier_invoice")) {
    const tokens = partialTokens(entity.reference ?? "");
    if (tokens.some((t) => haystack.includes(t))) {
      score += WEIGHTS.partialReference;
      reasons.push("Partial invoice number match");
    }
  }

  // 2. the partner's name in the row's text — whole, or one of its tokens (Nordea truncates, F116 FR-003); a
  //    reference too (every text field, v1 skipped `sender`)
  const name = entity.partnerName ? normalise(entity.partnerName) : "";
  const nameHit =
    (name.length >= 3 && haystack.includes(name)) ||
    nameTokens(entity.partnerName ?? "").some((t) => tokenHit(t, rowWords));
  if (nameHit) {
    score += WEIGHTS.partnerName;
    reasons.push(NAME_LABEL[entity.type] ?? "Partner name match");
    reference = true;
  }

  // 2a. the counterparty memory: this row's counterparty was linked to the entity's partner before (F116 FR-004,
  //     D67 — a reference: eleven confirmations say more than a name in a truncated field)
  const remembered = entity.partnerId ? memory?.get(entity.partnerId) : undefined;
  if (remembered && remembered.count > 0) {
    score += WEIGHTS.memory;
    reasons.push(
      remembered.count === 1
        ? `Linked to ${remembered.name} once before`
        : `Linked to ${remembered.name} ${remembered.count} times before`,
    );
    reference = true;
  }

  // 2b. a word of the entity's own description in the row's text (`OPENAI *CHATGPT` ↔ "OpenAI subscription") —
  //     a hint, never a reference
  const keywords = (entity.keywords ?? [])
    .map(normalise)
    .filter((k) => k.length >= 4 && !GENERIC_WORDS.has(k));
  if (keywords.some((k) => haystack.includes(k))) {
    score += WEIGHTS.keyword;
    reasons.push("Description keyword match");
  }

  // 3. the amount — same currency, or the SEK bases (cross-currency, within 6 %); nothing when a currency is
  //    not known (F61-b: an unread receipt is not SEK)
  const unknownCurrency = row.currency === null || entity.currency === null;
  const crossCurrency = !unknownCurrency && row.currency !== entity.currency;
  const rowAmount = new D(row.amount).abs();
  const entityAmount = new D(entity.amount).abs();
  const entityRemaining = new D(entity.remaining).abs();
  let tier: number | null = null;
  if (unknownCurrency) {
    // no amount points, no penalty, never dropped
  } else if (!crossCurrency) {
    const tiers = [amountTier(rowAmount, entityAmount)];
    // a row that pays exactly what is still open on a partly paid entity is an exact match too
    if (entityRemaining.gt(0) && !entityRemaining.eq(entityAmount))
      tiers.push(amountTier(rowAmount, entityRemaining));
    tier = tiers.filter((t): t is number => t !== null).sort((a, b) => a - b)[0] ?? null;
    if (tier !== null) {
      score += WEIGHTS.amount[tier];
      reasons.push(AMOUNT_REASON[tier]);
    }
  } else if (row.amountBase && entity.amountBase) {
    const rowBase = new D(row.amountBase).abs();
    const entityBase = new D(entity.amountBase).abs();
    if (entityBase.lte(0)) return null;
    const diff = rowBase.minus(entityBase).abs().div(entityBase);
    if (diff.gt(CROSS_CURRENCY_TOLERANCE) && !reference) return null;
    tier = amountTier(rowBase, entityBase);
    if (tier !== null) {
      score += WEIGHTS.amount[tier];
      reasons.push(AMOUNT_REASON[tier]);
      reasons.push(`Cross-currency match (${entity.currency}→${row.currency} at ECB)`);
    }
  } else if (!reference) {
    return null;
  } else {
    reasons.push("Cross-currency match (no rate to compare)");
  }

  // 4. the date — inside the payment window only (F116); outside it, nothing is claimed
  const claimedBeforeDate = reasons.length > 0;
  const date = dateClaim(row.date, entity);
  if (date) {
    score += date.points;
    reasons.push(date.reason);
  }
  // a pair whose only claim is its date is no suggestion (F116 FR-002)
  if (!claimedBeforeDate) return null;

  // 5. the currency penalty — waived when a reference matched
  if (crossCurrency) {
    if (reference) reasons.push("Currency differs but reference matches");
    else {
      score += WEIGHTS.currencyPenalty;
      reasons.push(`Currency mismatch (${entity.currency}≠${row.currency})`);
    }
  }

  return {
    score,
    confidence: confidenceOf(score, reference, tier),
    reasons,
    reference,
    crossCurrency,
  };
}

/**
 * What applying the pair would allocate: `min(open on the row, open on the entity)` in the shared currency; null
 * when the currencies differ or one is not known — such a pair is linked without an allocation, or not here.
 */
export function proposedAllocation(
  match: Pick<MatchResult, "crossCurrency">,
  row: { remaining: string; currency: string | null },
  entity: { remaining: string; currency: string | null },
): string | null {
  if (match.crossCurrency || row.currency === null || entity.currency === null) return null;
  return D.min(new D(row.remaining), new D(entity.remaining)).toFixed(2);
}

const TIER: Record<Confidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** HIGH > MEDIUM > LOW, then score, then label — a total order (R7). */
export function rank<T extends MatchResult & { candidate: { label: string; id: string } }>(
  items: T[],
): T[] {
  return items
    .slice()
    .sort(
      (a, b) =>
        TIER[a.confidence] - TIER[b.confidence] ||
        b.score - a.score ||
        a.candidate.label.localeCompare(b.candidate.label) ||
        a.candidate.id.localeCompare(b.candidate.id),
    );
}
