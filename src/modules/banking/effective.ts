// The effective partner and category of a bank row (F129, D73 (a) = specs/banking/one-table.md US4 / FR-006, D58):
// what the row shows on read — the value the owner typed by hand, else the proof's (the entity the row `justifies`
// or `settles`), else a rule's; never written back (T028, D82: the Justify click types nothing). Pure, client-safe,
// no module imports: the reads hand it the row's typed facts and the facts of each allocating link's target. The
// larger allocation (by base) speaks for the row; two proofs that disagree flag `mixed`. A `settles` link pays the
// owner back, so its partner is the owner as employee; its category follows the expense like a `justifies`. MUST
// NOT import from next/* or src/components/*.
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
 * `effectiveFactsOf(row, proofs, ownerPartnerId)`: a value typed by hand wins; else the first non-null value of the
 * proofs ordered by their base, largest first (ties keep the caller's order — the links as created); `mixed` when
 * the proofs name more than one partner or more than one account among them. A value a **rule** typed is a guess:
 * on a row with a proof it yields to the proof's, and fills in only what the proofs leave blank (D82, T028).
 */
export function effectiveFactsOf(
  row: {
    partnerId: string | null;
    basCode: string | null;
    /** who typed the values; `rule` lets a proof speak over them (D82) — absent = typed by hand */
    categorisedBy?: string | null;
  },
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
  const proofFirst = row.categorisedBy === "rule";
  const partner = pick(row.partnerId, proofPartner, proofFirst);
  const code = pick(row.basCode, proofCode, proofFirst);
  return {
    partnerId: partner.value,
    partnerFrom: partner.from,
    basCode: code.value,
    basFrom: code.from,
    mixed: partners.size > 1 || codes.size > 1,
  };
}

function pick(
  typed: string | null,
  proof: string | null,
  proofFirst: boolean,
): { value: string | null; from: FactSource | null } {
  if (proofFirst && proof) return { value: proof, from: "proof" };
  if (typed) return { value: typed, from: "row" };
  if (proof) return { value: proof, from: "proof" };
  return { value: null, from: null };
}

/**
 * What a row teaches the learning (T028, D82) — the proposals' history, the model's examples, the partner's BAS
 * history: a value the owner typed by hand, or one his proof gives; a rule's guess never (it would teach the
 * history what it already proposes). Per fact: `null` = nothing to learn from this row for it.
 */
export function learnedFacts(
  categorisedBy: string | null,
  e: Pick<EffectiveFacts, "partnerId" | "partnerFrom" | "basCode" | "basFrom">,
): { partnerId: string | null; basCode: string | null } {
  const hand = categorisedBy === "manual";
  const learns = (from: FactSource | null) => from === "proof" || (from === "row" && hand);
  return {
    partnerId: learns(e.partnerFrom) ? e.partnerId : null,
    basCode: learns(e.basFrom) ? e.basCode : null,
  };
}
