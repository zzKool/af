// The bank's implied rate of a transfer pair (D44): derived from the `transfer` link on every read, never stored —
// an unpairing takes it away and a re-pair with another leg brings that pair's rate. Informational only: it never
// replaces `rate` (D3, the bas-accounting skill). Reads the links, so it lives apart from `facts.ts` (see there).
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import * as linking from "@/modules/linking";

const D = Prisma.Decimal;

type Leg = { amount: string; currency: string };

/**
 * Base units per foreign unit of a pair: |base leg| ÷ |foreign leg|, 6 dp half-up (the rate the transfer proposal
 * shows). Null when `row` is not the foreign leg of a base-currency pair (same currency, or no base leg).
 */
export function impliedRate(row: Leg, peer: Leg): string | null {
  if (row.currency === BASE_CURRENCY || peer.currency !== BASE_CURRENCY) return null;
  const foreign = new D(row.amount).abs();
  if (foreign.isZero()) return null;
  return new D(peer.amount).abs().div(foreign).toDecimalPlaces(6, D.ROUND_HALF_UP).toString();
}

/**
 * The rows with `bankImplicitRate` derived: a foreign-currency row that sits in a `transfer` link with a
 * base-currency row gets the pair's rate; every other row null. Two queries for any number of rows (the links
 * through linking's read API, the peer legs from the rows).
 */
export async function withImplicitRates<T extends { id: string } & Leg>(
  tx: TransactionClient,
  rows: readonly T[],
): Promise<(T & { bankImplicitRate: string | null })[]> {
  const foreign = rows.filter((r) => r.currency !== BASE_CURRENCY);
  if (foreign.length === 0) return rows.map((r) => ({ ...r, bankImplicitRate: null }));
  const links = await linking.linksTouching(
    tx,
    "bank_transaction",
    foreign.map((r) => r.id),
    { kinds: ["transfer"] },
  );
  const peerOf = new Map<string, string>();
  for (const l of links) {
    peerOf.set(l.from.id, l.to.id);
    peerOf.set(l.to.id, l.from.id);
  }
  const peerIds = [...new Set(foreign.flatMap((r) => peerOf.get(r.id) ?? []))];
  const peers =
    peerIds.length === 0
      ? []
      : await tx.bankTransaction.findMany({
          where: { id: { in: peerIds } },
          select: { id: true, amount: true, currency: true },
        });
  const peerLeg = new Map(
    peers.map((p) => [p.id, { amount: p.amount.toFixed(2), currency: p.currency }]),
  );
  return rows.map((r) => {
    const peerId = peerOf.get(r.id);
    const peer = peerId ? peerLeg.get(peerId) : undefined;
    return { ...r, bankImplicitRate: peer ? impliedRate(r, peer) : null };
  });
}
