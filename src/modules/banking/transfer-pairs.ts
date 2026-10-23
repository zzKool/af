// Transfer pairs (specs/banking/spec.md US3, harvest §4.7, D25): a currency exchange or a move between own
// accounts shows as two rows that justify each other. Pure detection (`transferCandidates`) + the service
// (propose, accept → one `transfer` link, the bank implicit rate on the foreign entry; the legs' facts untouched).
// Thresholds are constants: a solo company with three accounts has nothing to configure here.
import { Prisma } from "@/generated/prisma/browser";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import * as journal from "@/modules/journal";
import * as linking from "@/modules/linking";
import * as rates from "@/modules/rates";
import { accountLabel } from "./bank-accounts";
import { bankText } from "./rules";
import type { TransferProposal } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** the two legs are booked within this many days of each other */
export const MAX_DATE_GAP_DAYS = 2;
/** the bank's implied rate may deviate this much from the ECB rate of the day (spread + weekend rate) */
export const MAX_RATE_DEVIATION = 0.05;
const HINT_WORDS = [
  "CHANGE",
  "CHFSEK",
  "SEKCHF",
  "ÖVERFÖRING",
  "OVERFORING",
  "TRANSFER",
  "EGET KONTO",
];

export type TransferLeg = {
  id: string;
  bankAccountId: string;
  accountNumber: string;
  accountLabel: string;
  bookingDate: string;
  amount: string;
  currency: string;
  text: string;
};

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

function hintsFor(a: TransferLeg, b: TransferLeg): string[] {
  const hints: string[] = [];
  const text = `${a.text} ${b.text}`.toUpperCase();
  for (const w of HINT_WORDS) if (text.includes(w)) hints.push(w);
  const other = b.accountNumber.replace(/[\s-]+/g, "");
  const mine = a.accountNumber.replace(/[\s-]+/g, "");
  const compact = text.replace(/[\s-]+/g, "");
  if (other && compact.includes(other)) hints.push("account");
  else if (mine && compact.includes(mine)) hints.push("account");
  return [...new Set(hints)];
}

/**
 * Candidates for leg `a` among `others` (transactions of the other own accounts, not already paired):
 * opposite sign, ≤ 2 days apart; same currency → equal amounts (rate 1); else the implied SEK ÷ foreign
 * rate within 5 % of the ECB rate (`ecbRate` = SEK per unit of the foreign currency on a's date).
 */
export function transferCandidates(
  a: TransferLeg,
  others: readonly TransferLeg[],
  ecbRate: Dec | null,
): TransferProposal[] {
  const amountA = new D(a.amount);
  if (amountA.isZero()) return [];
  const out: TransferProposal[] = [];
  for (const b of others) {
    if (b.id === a.id || b.bankAccountId === a.bankAccountId) continue;
    const amountB = new D(b.amount);
    if (amountB.isZero() || amountA.isNegative() === amountB.isNegative()) continue;
    if (daysBetween(a.bookingDate, b.bookingDate) > MAX_DATE_GAP_DAYS) continue;
    const absA = amountA.abs();
    const absB = amountB.abs();
    let implied: Dec;
    let ecb: Dec | null = null;
    let deviation: Dec | null = null;
    if (a.currency === b.currency) {
      if (!absA.eq(absB)) continue;
      implied = new D(1);
    } else {
      // one leg must be in the base currency for the implied rate to be SEK per foreign unit
      const sekLeg =
        a.currency === BASE_CURRENCY ? absA : b.currency === BASE_CURRENCY ? absB : null;
      const foreignLeg =
        a.currency === BASE_CURRENCY ? absB : b.currency === BASE_CURRENCY ? absA : null;
      if (!sekLeg || !foreignLeg || !ecbRate) continue;
      implied = sekLeg.div(foreignLeg).toDecimalPlaces(6, D.ROUND_HALF_UP);
      ecb = ecbRate;
      deviation = implied.div(ecbRate).minus(1).abs();
      if (deviation.gt(MAX_RATE_DEVIATION)) continue;
    }
    const hints = hintsFor(a, b);
    const debit = amountA.isNegative() ? a : b;
    const credit = amountA.isNegative() ? b : a;
    out.push({
      from: leg(debit),
      to: leg(credit),
      implied: implied.toFixed(6),
      ecb: ecb ? ecb.toFixed(6) : null,
      deviationPercent: deviation ? deviation.mul(100).toFixed(2) : null,
      hints,
      confidence:
        hints.length > 0 || deviation?.lt(0.02) || a.currency === b.currency ? "high" : "medium",
    });
  }
  // best first: same-day and hinted pairs
  return out.sort(
    (x, y) =>
      Number(y.confidence === "high") - Number(x.confidence === "high") ||
      daysBetween(x.from.bookingDate, x.to.bookingDate) -
        daysBetween(y.from.bookingDate, y.to.bookingDate),
  );
}

function leg(l: TransferLeg): TransferProposal["from"] {
  return {
    id: l.id,
    bookingDate: l.bookingDate,
    amount: l.amount,
    currency: l.currency,
    accountLabel: l.accountLabel,
  };
}

// --- service ---

const violation = (message: string, details?: Record<string, string | number>): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});
const notFound = (what: string, id: string): AppError => ({
  code: "NOT_FOUND",
  message: `${what} not found: ${id}`,
  retryable: false,
});

const iso = (d: Date): string => d.toISOString().slice(0, 10);

async function legOf(
  tx: TransactionClient,
  id: string,
): Promise<(TransferLeg & { row: { id: string } }) | null> {
  const t = await tx.bankTransaction.findUnique({ where: { id }, include: { bankAccount: true } });
  if (!t) return null;
  return {
    id: t.id,
    bankAccountId: t.bankAccountId,
    accountNumber: t.bankAccount.accountNumber,
    accountLabel: accountLabel(t.bankAccount),
    bookingDate: iso(t.bookingDate),
    amount: t.amount.toFixed(2),
    currency: t.currency,
    text: bankText(t),
    row: { id: t.id },
  };
}

/** ids of transactions already in a `transfer` link (through linking's read API, lessons audit 22) */
async function pairedIds(tx: TransactionClient, ids: readonly string[]): Promise<Set<string>> {
  const links = await linking.linksTouching(tx, "bank_transaction", ids, { kinds: ["transfer"] });
  return new Set(links.flatMap((l) => [l.from.id, l.to.id]));
}

/** The transfer proposals for one transaction (empty when it is already paired). */
export async function proposeTransfers(
  tx: TransactionClient,
  transactionId: string,
): Promise<ServiceResult<TransferProposal[]>> {
  const a = await legOf(tx, transactionId);
  if (!a) return { error: notFound("Bank transaction", transactionId) };
  if ((await pairedIds(tx, [a.id])).has(a.id)) return { data: [] };
  const from = new Date(`${a.bookingDate}T00:00:00Z`);
  const lo = new Date(from.getTime() - MAX_DATE_GAP_DAYS * 86_400_000);
  const hi = new Date(from.getTime() + MAX_DATE_GAP_DAYS * 86_400_000);
  const rows = await tx.bankTransaction.findMany({
    where: {
      bankAccountId: { not: a.bankAccountId },
      bookingDate: { gte: lo, lte: hi },
      amount: new D(a.amount).isNegative() ? { gt: 0 } : { lt: 0 },
    },
    include: { bankAccount: true },
  });
  const paired = await pairedIds(
    tx,
    rows.map((r) => r.id),
  );
  const others: TransferLeg[] = rows
    .filter((r) => !paired.has(r.id))
    .map((t) => ({
      id: t.id,
      bankAccountId: t.bankAccountId,
      accountNumber: t.bankAccount.accountNumber,
      accountLabel: accountLabel(t.bankAccount),
      bookingDate: iso(t.bookingDate),
      amount: t.amount.toFixed(2),
      currency: t.currency,
      text: bankText(t),
    }));
  // the ECB rate of a's date for the foreign currency of the pair (SEK per unit)
  let ecb: Dec | null = null;
  const foreign = [a, ...others].map((l) => l.currency).find((c) => c !== BASE_CURRENCY);
  if (foreign) {
    const r = await rates.rateToBase(tx, a.bookingDate, foreign, BASE_CURRENCY);
    ecb = r ? r.rate : null;
  }
  return { data: transferCandidates(a, others, ecb) };
}

/**
 * Accept a pair: one `transfer` link debit → credit and the foreign entry's bank implicit rate — nothing else is
 * written on the legs (F65): their state derives `no_document` from the link. Refused when either side is already
 * paired or the pair is not a candidate.
 */
export async function acceptTransfer(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { fromId: string; toId: string },
): Promise<ServiceResult<{ linkId: string; implied: string }>> {
  if (input.fromId === input.toId) return { error: violation("A transfer needs two transactions") };
  const proposals = await proposeTransfers(tx, input.fromId);
  if (proposals.error) return { error: proposals.error };
  const match = proposals.data.find(
    (p) =>
      (p.from.id === input.fromId && p.to.id === input.toId) ||
      (p.from.id === input.toId && p.to.id === input.fromId),
  );
  if (!match)
    return {
      error: violation("These two transactions are not a transfer pair (or one is already paired)"),
    };
  const link = await linking.createLink(tx, caller, audit, {
    from: { type: "bank_transaction", id: match.from.id },
    to: { type: "bank_transaction", id: match.to.id },
    kind: "transfer",
    note: match.ecb ? `implied ${match.implied} (ECB ${match.ecb})` : "own-account move",
  });
  if (link.error) return { error: link.error };
  const entries = await journal.entriesForSources(tx, "bank_transaction", [
    match.from.id,
    match.to.id,
  ]);
  // the owner's facts (category, partner, "no document needed", who categorised) stay as they were: "transfer"
  // is the link itself, derived wherever it is read — the bank's implied rate too (journal `withImplicitRates`,
  // F86 dropped the stored copy) — unpairing leaves the legs as before, rules still see them
  for (const id of [match.from.id, match.to.id]) {
    if (!entries.get(id)) return { error: notFound("Journal entry of transaction", id) };
  }
  return { data: { linkId: link.data.id, implied: match.implied } };
}
