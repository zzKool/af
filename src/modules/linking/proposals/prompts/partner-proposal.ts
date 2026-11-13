// The model's partner question for one bank row (F98 T013b, specs/ai FR-005, US2; docs/local-ai.md §5): who is the
// counterparty behind this bank text — one of the tenant's partners, a company not among them yet, or unknown.
// Pure: the messages and the output schema. Static parts first — the instructions and the tenant's partners — so
// the server's prompt cache reuses them across the rows of a run; the row last.
//
// What the model knows about a company comes from its own knowledge and the tenant's partner list, never from
// this file: no vendor or product is named here (the SC-202 test greps this folder).
import { createHash } from "node:crypto";
import { z } from "zod";

/** Bumped with any change of the text below — logged with every call, part of a proposal's facts. */
export const PARTNER_PROPOSAL_VERSION = "partner-proposal.v1";
export const PARTNER_PROPOSAL_TASK = "linking.partner-proposal";

/** The kinds the model may give a company it does not find in the list (the payload's words). */
export const NEW_PARTNER_KINDS = ["supplier", "client", "authority"] as const;
export type NewPartnerKind = (typeof NEW_PARTNER_KINDS)[number];

/** A partner as the prompt lists it. `ref` is the short handle the model answers with — never the id. */
export type PromptPartner = {
  ref: string;
  id: string;
  name: string;
  types: readonly string[];
  country?: string | null;
};

/**
 * The tenant's active partners as the prompt lists them, in a stable order (by name, then id) with `p1 … pn`
 * handles: a short enum for the grammar, and a list that stays byte-identical between runs while no partner changes.
 */
export function toPromptPartners(
  partners: readonly {
    id: string;
    name: string;
    types: readonly string[];
    country?: string | null;
  }[],
): PromptPartner[] {
  return [...partners]
    .sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id))
    .map((p, i) => ({
      ref: `p${i + 1}`,
      id: p.id,
      name: p.name,
      types: p.types,
      country: p.country ?? null,
    }));
}

export type PartnerPromptRow = {
  bookingDate: string;
  amount: string;
  currency: string;
  /** the counterparty key — the bank text without the card prefix, the digits and the noise */
  counterparty: string;
  text: string;
};

const SYSTEM = [
  "You name the counterparty of one bank transaction of a small Swedish consulting company (aktiebolag).",
  "A bank text is often a card descriptor: an abbreviation, a product name or a payment processor's prefix in",
  "front of the real company. Name the company that was paid, or that paid.",
  "If it is one of the partners listed below, answer with its handle in `partner` and leave `newPartner` null.",
  "If it is a company you recognise that is not in the list, leave `partner` null and give `newPartner`: its",
  "usual short name as a person would write it (no legal suffix, no store or reference number), its kind",
  "(supplier: the company pays it; client: it pays the company; authority: a tax agency or a public body) and",
  "its country as two letters when you know it, else null.",
  "If you cannot tell who it is — a person's name, a bare reference, a transfer between own accounts — leave",
  "both null. Never invent a company.",
  "A negative amount is money out; a positive amount is money in.",
  "confidence: 0.9 or more only when the text clearly names the company; 0.6–0.8 when it is likely; below 0.5",
  "when you are guessing. reason: one short English sentence saying what in the text names it, no amounts.",
].join("\n");

function partnerLine(p: PromptPartner): string {
  const details = [p.types.join(" / "), p.country ?? ""].filter((d) => d !== "");
  return `${p.ref} ${p.name}${details.length ? ` (${details.join(", ")})` : ""}`;
}

/** The static part of the prompt — the same for every row of a run. */
export function partnerProposalSystem(partners: readonly PromptPartner[]): string {
  const parts = [SYSTEM, "", "Partners:"];
  if (partners.length === 0) parts.push("(none yet)");
  else parts.push(...partners.map(partnerLine));
  return parts.join("\n");
}

export function partnerProposalUser(row: PartnerPromptRow): string {
  return [
    `Date: ${row.bookingDate}`,
    `Amount: ${row.amount} ${row.currency}`,
    `Counterparty: ${row.counterparty || "(none)"}`,
    `Bank text: ${row.text || "(none)"}`,
  ].join("\n");
}

/**
 * What the model may answer: a handle from the list (the enum — the server's grammar cannot produce another) or
 * null, a new company or null, a confidence, a reason.
 */
export function partnerProposalSchema(refs: readonly string[]) {
  const partner = refs.length ? z.enum(refs as [string, ...string[]]).nullable() : z.null();
  return z.object({
    partner,
    newPartner: z
      .object({
        name: z.string().trim().min(1).max(80),
        type: z.enum(NEW_PARTNER_KINDS),
        country: z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .nullable(),
      })
      .nullable(),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(160),
  });
}
export type PartnerProposalAnswer = z.infer<ReturnType<typeof partnerProposalSchema>>;

/**
 * What a model partner proposal was made on, besides the row: the prompt's version only — not the partner list
 * (a partner created tomorrow must not re-ask every open row, nor bring a rejected proposal back: the owner's
 * answer 6, 2026-11-08 — a *no* holds until the model or the prompt changes).
 */
export function partnerPromptFactsHash(): string {
  return createHash("sha256").update(PARTNER_PROPOSAL_VERSION).digest("hex").slice(0, 16);
}
