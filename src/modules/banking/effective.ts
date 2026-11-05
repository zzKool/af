// The effective partner and category of a bank row (F129, D73 (a) = specs/banking/one-table.md US4 / FR-006, D58):
// what the row shows on read — the typed value when the owner or a rule set one, else the proof's (the entity the
// row `justifies` or `settles`), never written back. Pure, client-safe, no module imports: the reads hand it the
// row's typed facts and the facts of each allocating link's target. The larger allocation (by base) speaks for the
// row; two proofs that disagree flag `mixed`. A `settles` link pays the owner back, so its partner is the owner as
// employee; its category follows the expense like a `justifies`. MUST NOT import from next/* or src/components/*.
import { Prisma } from "@/generated/prisma/browser";

const D = Prisma.Decimal;

/** One allocating link's target, as the owner's linkable states it (`factsMany`): what the row inherits from it. */
export type ProofFact = {
  kind: "justifies" | "settles";
  /** what the row gave for it, in the base — the larger one speaks for the row; null counts as nothing */
  allocatedBase: string | null;
  /** the entity's partner (a document carries none) */
  partnerId: string | null;
  /** the entity's BAS account (an expense's, a supplier invoice's; an invoice or a document carries none) */
  basCode: string | null;
};

/** Where a shown value comes from: typed on the row (by hand or by a rule), or derived from the proof. */
export type FactSource = "row" | "proof";

export type EffectiveFacts = {
  partnerId: string | null;
  partnerFrom: FactSource | null;
  basCode: string | null;
  basFrom: FactSource | null;
  /** the proofs disagree on the partner or the category — the list's tag, the bank sheet's *Flags* cell */
  mixed: boolean;
};

const NONE: EffectiveFacts = {
  partnerId: null,
  partnerFrom: null,
  basCode: null,
  basFrom: null,
  mixed: false,
};

/**
 * `effectiveFactsOf(row, proofs, ownerPartnerId)`: a typed value wins; else the first non-null value of the proofs
 * ordered by their base, largest first (ties keep the caller's order — the links as created); `mixed` when the
 * proofs name more than one partner or more than one account among them.
 */
export function effectiveFactsOf(
  row: { partnerId: string | null; basCode: string | null },
  proofs: readonly ProofFact[],
  ownerPartnerId: string | null,
): EffectiveFacts {
  if (proofs.length === 0) {
    return {
      ...NONE,
      partnerId: row.partnerId,
      partnerFrom: row.partnerId ? "row" : null,
      basCode: row.basCode,
      basFrom: row.basCode ? "row" : null,
    };
  }
  const ordered = proofs
    .map((p, i) => ({
      i,
      base: p.allocatedBase ? new D(p.allocatedBase).abs() : new D(0),
      partnerId: p.kind === "settles" ? ownerPartnerId : p.partnerId,
      basCode: p.basCode,
    }))
    .sort((a, b) => b.base.comparedTo(a.base) || a.i - b.i);
  const partners = new Set(ordered.map((p) => p.partnerId).filter((v): v is string => !!v));
  const codes = new Set(ordered.map((p) => p.basCode).filter((v): v is string => !!v));
  const proofPartner = ordered.find((p) => p.partnerId)?.partnerId ?? null;
  const proofCode = ordered.find((p) => p.basCode)?.basCode ?? null;
  return {
    partnerId: row.partnerId ?? proofPartner,
    partnerFrom: row.partnerId ? "row" : proofPartner ? "proof" : null,
    basCode: row.basCode ?? proofCode,
    basFrom: row.basCode ? "row" : proofCode ? "proof" : null,
    mixed: partners.size > 1 || codes.size > 1,
  };
}
