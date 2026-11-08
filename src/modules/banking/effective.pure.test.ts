// The effective partner and category of a bank row (F129, D73 (a) — specs/justify/rework.md FR-004 / US1): a typed
// value wins; else the proof's, the larger allocation first; two proofs that disagree flag `mixed`; a `settles`
// proof's partner is the owner as employee; a document proof carries nothing. Pure — the worked examples of the
// spec, and as a property: the result's partner is the typed one, one of the proofs' (or the owner's), or null.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { effectiveFactsOf, type ProofFact } from "./effective";

const SKATTEPUNKTEN = "11111111-1111-4111-8111-111111111111";
const OPENAI = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const TYPED = "44444444-4444-4444-8444-444444444444";

const justifies = (
  allocatedBase: string | null,
  partnerId: string | null,
  basCode: string | null,
): ProofFact => ({
  kind: "justifies",
  allocatedBase,
  partnerId,
  basCode,
});
const settles = (allocatedBase: string, basCode: string | null): ProofFact => ({
  kind: "settles",
  allocatedBase,
  partnerId: null,
  basCode,
});
const none = { partnerId: null, basCode: null };

describe("effectiveFactsOf", () => {
  it("example 1: one supplier invoice gives the row its partner and account, from the proof", () => {
    expect(effectiveFactsOf(none, [justifies("1297.20", SKATTEPUNKTEN, "6540")], OWNER)).toEqual({
      partnerId: SKATTEPUNKTEN,
      partnerFrom: "proof",
      basCode: "6540",
      basFrom: "proof",
      mixed: false,
    });
  });

  it("example 2: a typed category wins, the partner stays derived; a typed partner wins too", () => {
    const proofs = [justifies("1297.20", SKATTEPUNKTEN, "6540")];
    expect(effectiveFactsOf({ partnerId: null, basCode: "6530" }, proofs, OWNER)).toMatchObject({
      partnerId: SKATTEPUNKTEN,
      partnerFrom: "proof",
      basCode: "6530",
      basFrom: "row",
    });
    expect(effectiveFactsOf({ partnerId: TYPED, basCode: null }, proofs, OWNER)).toMatchObject({
      partnerId: TYPED,
      partnerFrom: "row",
      basCode: "6540",
      basFrom: "proof",
    });
  });

  it("nothing typed, no proof: nulls; typed without a proof: the row's", () => {
    expect(effectiveFactsOf(none, [], OWNER)).toEqual({
      partnerId: null,
      partnerFrom: null,
      basCode: null,
      basFrom: null,
      mixed: false,
    });
    expect(effectiveFactsOf({ partnerId: TYPED, basCode: "6570" }, [], null)).toEqual({
      partnerId: TYPED,
      partnerFrom: "row",
      basCode: "6570",
      basFrom: "row",
      mixed: false,
    });
  });

  it("example 8: two receipts — the larger base speaks (OpenAI · 6540), the proofs disagree: mixed", () => {
    expect(
      effectiveFactsOf(
        none,
        [justifies("80.00", null, "5410"), justifies("120.00", OPENAI, "6540")],
        OWNER,
      ),
    ).toEqual({
      partnerId: OPENAI,
      partnerFrom: "proof",
      basCode: "6540",
      basFrom: "proof",
      mixed: true,
    });
  });

  it("two proofs that agree are not mixed; ties keep the links' order; a base of null counts as nothing", () => {
    expect(
      effectiveFactsOf(
        none,
        [justifies("50.00", OPENAI, "6540"), justifies("50.00", OPENAI, "6540")],
        OWNER,
      ).mixed,
    ).toBe(false);
    expect(
      effectiveFactsOf(
        none,
        [justifies("50.00", OPENAI, "6540"), justifies("50.00", SKATTEPUNKTEN, "6530")],
        OWNER,
      ),
    ).toMatchObject({ partnerId: OPENAI, basCode: "6540", mixed: true });
    expect(
      effectiveFactsOf(
        none,
        [justifies(null, null, null), justifies("10.00", OPENAI, "6540")],
        OWNER,
      ),
    ).toMatchObject({ partnerId: OPENAI, basCode: "6540", mixed: false });
  });

  it("example 7: two settles links — the owner as employee, the larger expense's account, mixed", () => {
    expect(
      effectiveFactsOf(none, [settles("999.70", "5800"), settles("400.00", "5830")], OWNER),
    ).toEqual({
      partnerId: OWNER,
      partnerFrom: "proof",
      basCode: "5800",
      basFrom: "proof",
      mixed: true,
    });
    // no owner partner seeded: the refund's partner is unknown, the category still follows the expense
    expect(effectiveFactsOf(none, [settles("999.70", "5800")], null)).toMatchObject({
      partnerId: null,
      partnerFrom: null,
      basCode: "5800",
      basFrom: "proof",
    });
  });

  it("example 9: a plain document proof carries nothing — the row stays without a partner", () => {
    expect(effectiveFactsOf(none, [justifies("450.00", null, null)], OWNER)).toEqual({
      partnerId: null,
      partnerFrom: null,
      basCode: null,
      basFrom: null,
      mixed: false,
    });
  });

  it("property: the partner is the typed one, one of the proofs' (the owner's for settles) or null; the same for the account", () => {
    const id = fc.constantFrom(SKATTEPUNKTEN, OPENAI, TYPED, null);
    const code = fc.constantFrom("6540", "6530", "5800", null);
    const proof = fc.record({
      kind: fc.constantFrom<"justifies" | "settles">("justifies", "settles"),
      allocatedBase: fc.option(
        fc.integer({ min: 0, max: 1_000_000 }).map((c) => (c / 100).toFixed(2)),
        {
          nil: null,
        },
      ),
      partnerId: id,
      basCode: code,
    });
    fc.assert(
      fc.property(
        id,
        code,
        fc.array(proof, { maxLength: 5 }),
        fc.constantFrom(OWNER, null),
        (typedPartner, typedCode, proofs, owner) => {
          const r = effectiveFactsOf(
            { partnerId: typedPartner, basCode: typedCode },
            proofs,
            owner,
          );
          const partnersOfProofs = proofs.map((p) => (p.kind === "settles" ? owner : p.partnerId));
          if (typedPartner)
            expect(r).toMatchObject({ partnerId: typedPartner, partnerFrom: "row" });
          else if (r.partnerId) expect(partnersOfProofs).toContain(r.partnerId);
          else expect(r.partnerFrom).toBeNull();
          if (typedCode) expect(r).toMatchObject({ basCode: typedCode, basFrom: "row" });
          else if (r.basCode) expect(proofs.map((p) => p.basCode)).toContain(r.basCode);
          else expect(r.basFrom).toBeNull();
          // mixed says the proofs disagree — never from a typed value, never with one proof
          const partners = new Set(partnersOfProofs.filter(Boolean));
          const codes = new Set(proofs.map((p) => p.basCode).filter(Boolean));
          expect(r.mixed).toBe(partners.size > 1 || codes.size > 1);
        },
      ),
    );
  });
});
