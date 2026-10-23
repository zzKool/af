// The one scorer (specs/linking/spec.md FR-002, harvest §4.1 / §8.1): a bank row against an entity, in either
// direction. Pure — Decimal strings in, a score with its reasons out; no I/O. Weights: full reference 40,
// partial invoice number 20, partner name 25, amount 40 / 30 / 20 / 10, date 30 / 25 / 15 / 5, currency −10
// unless a reference matched. HIGH = (reference ∧ ≥ 60) ∨ ≥ 80, MEDIUM ≥ 50, else LOW. A side whose currency is
// not known (null, F61-b) is never compared on the amount and never penalised: reference, name and date only.
import { Prisma } from "@/generated/prisma/client";
import { daysBetween } from "@/kernel/clock/calendar";
import type { Confidence, EntityFacts, LinkableType, MatchResult } from "./types";

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
  settlement: "Settlement number in message",
  bank_transaction: "Reference in message",
  journal_entry: "Reference in message",
  partner: "Name in message",
  contract: "Reference in message",
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

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

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

function amountTier(row: Dec, entity: Dec): number | null {
  if (entity.lte(0)) return null;
  const diff = row.minus(entity).abs().div(entity);
  if (diff.lt("0.001")) return 0;
  if (diff.lt("0.01")) return 1;
  if (diff.lt("0.05")) return 2;
  return 3;
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
export function scoreMatch(row: RowFacts, entity: EntityFacts): MatchResult | null {
  const reasons: string[] = [];
  let score = 0;
  let reference = false;
  const haystack = normalise(row.texts.filter(Boolean).join(" "));

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

  // 2. the partner's name in the row's text — a reference too (every text field, v1 skipped `sender`)
  const name = entity.partnerName ? normalise(entity.partnerName) : "";
  if (name.length >= 3 && haystack.includes(name)) {
    score += WEIGHTS.partnerName;
    reasons.push(NAME_LABEL[entity.type] ?? "Partner name match");
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
    }
    reasons.push(`Cross-currency match (${entity.currency}→${row.currency} at ECB)`);
  } else if (!reference) {
    return null;
  } else {
    reasons.push("Cross-currency match (no rate to compare)");
  }

  // 4. the date
  const days = daysBetween(row.date, entity.date);
  if (days === 0) {
    score += WEIGHTS.date[0];
    reasons.push("Same date");
  } else if (days <= 2) {
    score += WEIGHTS.date[1];
    reasons.push("Within 2 days");
  } else if (days <= 5) {
    score += WEIGHTS.date[2];
    reasons.push("Within 5 days");
  } else {
    score += WEIGHTS.date[3];
    reasons.push(`${days} days apart`);
  }

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
