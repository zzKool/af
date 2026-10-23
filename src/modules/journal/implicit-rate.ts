// The bank's implied rate of a transfer pair (T005, D44): derived from the `transfer` link on every read, never
// stored — an unpairing takes it away and a re-pair with another leg brings that pair's rate. Informational only:
// it never replaces `rate` (D3, the bas-accounting skill). The `bank_implicit_rate` column is no longer read.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import type { JournalEntryDto } from "./types";

const D = Prisma.Decimal;

type Leg = { amount: string; currency: string };

/**
 * Base units per foreign unit of a pair: |base leg| ÷ |foreign leg|, 6 dp half-up (the rate the banking proposal
 * shows). Null when `entry` is not the foreign leg of a base-currency pair (same currency, or no base leg).
 */
export function impliedRate(entry: Leg, peer: Leg): string | null {
  if (entry.currency === BASE_CURRENCY || peer.currency !== BASE_CURRENCY) return null;
  const foreign = new D(entry.amount).abs();
  if (foreign.isZero()) return null;
  return new D(peer.amount).abs().div(foreign).toDecimalPlaces(6, D.ROUND_HALF_UP).toString();
}

/**
 * The entries with `bankImplicitRate` derived: a bank entry whose transaction sits in a `transfer` link with a
 * base-currency transaction gets the pair's rate; every other entry gets null. Two queries for any number of
 * entries (the links through linking's read API, the peer legs' entries from the journal's own table).
 */
export async function withImplicitRates<T extends JournalEntryDto>(
  tx: TransactionClient,
  entries: readonly T[],
): Promise<T[]> {
  const foreign = entries.filter(
    (e) => e.sourceType === "bank_transaction" && e.sourceId && e.currency !== BASE_CURRENCY,
  );
  if (foreign.length === 0) return entries.map((e) => ({ ...e, bankImplicitRate: null }));
  // loaded on first use: a top-level import closes linking → linkables → banking → journal while journal.ts is
  // still loading, and journal.actions then reads an undefined schema ([[lessons]] *module-load cycles*)
  const linking = await import("@/modules/linking");
  const links = await linking.linksTouching(
    tx,
    "bank_transaction",
    foreign.map((e) => e.sourceId as string),
    { kinds: ["transfer"] },
  );
  const peerOf = new Map<string, string>();
  for (const l of links) {
    peerOf.set(l.from.id, l.to.id);
    peerOf.set(l.to.id, l.from.id);
  }
  const peerIds = [...new Set(foreign.flatMap((e) => peerOf.get(e.sourceId as string) ?? []))];
  const peers =
    peerIds.length === 0
      ? []
      : await tx.journalEntry.findMany({
          where: { sourceType: "bank_transaction", sourceId: { in: peerIds } },
          select: { sourceId: true, amount: true, currency: true },
        });
  const peerLeg = new Map(
    peers.map((p) => [p.sourceId as string, { amount: p.amount.toFixed(2), currency: p.currency }]),
  );
  return entries.map((e) => {
    const peerId = e.sourceId ? peerOf.get(e.sourceId) : undefined;
    const peer = peerId ? peerLeg.get(peerId) : undefined;
    return {
      ...e,
      bankImplicitRate: peer && e.sourceType === "bank_transaction" ? impliedRate(e, peer) : null,
    };
  });
}
