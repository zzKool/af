// Which bank row or receipt / bill fills which period (F94 FR-007, US3-1…3, US3-7, US4-1) — pure. A match is an
// offer, never a write: ambiguity is shown, never resolved here (nothing happens without the owner's click, D57).
import { Prisma } from "@/generated/prisma/browser";
import { rankPartnerMatches } from "@/modules/partners";
import type { DocumentMatch, Period, RowMatch } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** Same currency, within this many percent, found by the text: eligible for *Confirm all exact* (US3-8). */
export const EXACT_PCT = "0.5";
/** A vendor name scoring this much (the partners' scale: contains 60, exact 80) is the subscription's vendor. */
export const VENDOR_NAME_SCORE = 60;

/** The ECB rate from one currency to another on `date`; null when there is none (then nothing cross-currency matches). */
export type RateOf = (date: string, from: string, to: string) => string | null;

export type MatchSubscription = {
  partnerId: string;
  partnerName: string | null;
  partnerVatNumber: string | null;
  matchText: string | null;
  tolerancePct: string;
  basCode: string;
  /** the payer's bank account (null for a private payer: no row is ever matched) */
  bankAccountId: string | null;
};

export type MatchRow = {
  id: string;
  bankAccountId: string;
  bookingDate: string;
  /** absolute */
  amount: string;
  currency: string;
  texts: readonly string[];
  description: string;
  partnerId: string | null;
  basCode: string | null;
  noDocumentNeeded: boolean;
};

export type MatchDocument = {
  id: string;
  businessKey: string;
  vendorName: string | null;
  vendorVatNumber: string | null;
  invoiceNumber: string | null;
  date: string | null;
  total: string | null;
  currency: string | null;
};

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const alnum = (s: string | null) => (s ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();

/** |actual − expected| / expected × 100 */
function diffPct(actual: Dec, expected: Dec): Dec {
  return actual.minus(expected).abs().dividedBy(expected).times(100);
}

/**
 * `amount` in `currency` against the period's price: directly when the currencies agree, else the price converted
 * into `currency` at the ECB rate of `date` (a EUR price on the SEK card is compared in SEK — no base involved).
 */
function compare(
  amount: Dec,
  currency: string,
  price: { amount: string; currency: string },
  date: string,
  rateOf: RateOf,
): { diff: Dec; cross: boolean } | null {
  const expected = new D(price.amount);
  if (currency === price.currency) return { diff: diffPct(amount, expected), cross: false };
  const rate = rateOf(date, price.currency, currency);
  if (rate === null) return null;
  return { diff: diffPct(amount, expected.times(rate)), cross: true };
}

/** A bank row against one period of an expense subscription (US3-1…3); null when it is not a match. */
export function matchRow(
  period: Period,
  sub: MatchSubscription,
  row: MatchRow,
  rateOf: RateOf,
): Omit<RowMatch, "ambiguous"> | null {
  if (!period.price || sub.bankAccountId === null || row.bankAccountId !== sub.bankAccountId)
    return null;
  if (row.bookingDate < period.rowWindow.from || row.bookingDate > period.rowWindow.to) return null;
  const needle = sub.matchText ? fold(sub.matchText) : "";
  const byText = needle !== "" && row.texts.some((t) => fold(t).includes(needle));
  const byPartner = row.partnerId !== null && row.partnerId === sub.partnerId;
  if (!byText && !byPartner) return null;
  const c = compare(new D(row.amount), row.currency, period.price, row.bookingDate, rateOf);
  if (c === null || c.diff.greaterThan(sub.tolerancePct)) return null;
  const hints: RowMatch["hints"] = [];
  if (row.noDocumentNeeded) hints.push("rule_no_document");
  if (row.basCode !== null && row.basCode !== sub.basCode) hints.push("category_differs");
  return {
    rowId: row.id,
    bookingDate: row.bookingDate,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    diffPct: c.diff.toFixed(2),
    crossCurrency: c.cross,
    byText,
    exact: !c.cross && byText && c.diff.lessThanOrEqualTo(EXACT_PCT),
    hints,
  };
}

/** Is this document's vendor the subscription's? VAT equal → certain; else the name (or the match text). */
export function vendorMatches(
  sub: MatchSubscription,
  doc: MatchDocument,
): { matches: boolean; certain: boolean } {
  const vat = alnum(sub.partnerVatNumber);
  if (vat !== "" && vat === alnum(doc.vendorVatNumber)) return { matches: true, certain: true };
  if (!doc.vendorName) return { matches: false, certain: false };
  if (sub.matchText && fold(doc.vendorName).includes(fold(sub.matchText)))
    return { matches: true, certain: false };
  if (!sub.partnerName) return { matches: false, certain: false };
  const [best] = rankPartnerMatches({ name: doc.vendorName }, [
    { id: sub.partnerId, name: sub.partnerName, vatNumber: null, address: null, types: [] },
  ]);
  return { matches: (best?.score ?? 0) >= VENDOR_NAME_SCORE, certain: false };
}

/** A receipt / bill against one period (US4-1); null when it is not a match. */
export function matchDocument(
  period: Period,
  sub: MatchSubscription,
  doc: MatchDocument,
  rateOf: RateOf,
): Omit<DocumentMatch, "ambiguous"> | null {
  if (!doc.date || doc.date < period.receiptWindow.from || doc.date > period.receiptWindow.to)
    return null;
  const vendor = vendorMatches(sub, doc);
  if (!vendor.matches) return null;
  let diff: Dec | null = null;
  if (doc.total !== null && doc.currency !== null && period.price) {
    const c = compare(new D(doc.total), doc.currency, period.price, doc.date, rateOf);
    if (c !== null) {
      if (c.diff.greaterThan(sub.tolerancePct)) return null;
      diff = c.diff;
    }
  }
  return {
    documentId: doc.id,
    businessKey: doc.businessKey,
    date: doc.date,
    total: doc.total,
    currency: doc.currency,
    invoiceNumber: doc.invoiceNumber,
    certain: vendor.certain,
    diffPct: diff ? diff.toFixed(2) : null,
    amountUnknown: diff === null,
  };
}

/**
 * Offers across every period of every subscription: an offer seen by more than one period is marked ambiguous on
 * each (the owner picks); a period with more than one offer has them all marked. Pure bookkeeping, no ranking.
 */
export function markAmbiguity<T extends { ambiguous: boolean }>(
  offers: readonly { periodKey: string; itemId: string; offer: Omit<T, "ambiguous"> }[],
): Map<string, T[]> {
  const periodsOfItem = new Map<string, Set<string>>();
  const perPeriod = new Map<string, number>();
  for (const o of offers) {
    periodsOfItem.set(o.itemId, (periodsOfItem.get(o.itemId) ?? new Set()).add(o.periodKey));
    perPeriod.set(o.periodKey, (perPeriod.get(o.periodKey) ?? 0) + 1);
  }
  const out = new Map<string, T[]>();
  for (const o of offers) {
    const ambiguous =
      (periodsOfItem.get(o.itemId)?.size ?? 0) > 1 || (perPeriod.get(o.periodKey) ?? 0) > 1;
    const list = out.get(o.periodKey) ?? [];
    list.push({ ...o.offer, ambiguous } as T);
    out.set(o.periodKey, list);
  }
  return out;
}
