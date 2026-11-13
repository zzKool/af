// F98 T013b (specs/ai FR-005, US2): the partner prompt — the static part is the same for every row (the server's
// cache), the answer is bound to the listed partners, and the model's answer becomes a payload by fixed rules.
import { describe, expect, it } from "vitest";
import { partnerAnswerPayload, partnerRowFactsHash } from "../stage2-partner";
import {
  partnerPromptFactsHash,
  partnerProposalSchema,
  partnerProposalSystem,
  partnerProposalUser,
  toPromptPartners,
} from "./partner-proposal";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const LIST = toPromptPartners([
  { id: B, name: "Lakeside Assurance SA", types: ["client"], country: "CH" },
  { id: A, name: "Cloudhost AB", types: ["vendor"], country: null },
]);

const answer = (over: Record<string, unknown>) => ({
  partner: null,
  newPartner: null,
  confidence: 0.9,
  reason: "the text names it",
  ...over,
});

describe("the partner prompt", () => {
  it("lists the partners in a stable order with short handles — never an id", () => {
    expect(LIST.map((p) => [p.ref, p.name])).toEqual([
      ["p1", "Cloudhost AB"],
      ["p2", "Lakeside Assurance SA"],
    ]);
    const sys = partnerProposalSystem(LIST);
    expect(sys).toContain("p1 Cloudhost AB (vendor)");
    expect(sys).toContain("p2 Lakeside Assurance SA (client, CH)");
    expect(sys).not.toContain(A);
    // the same list in another order is the same prompt (the cache)
    expect(partnerProposalSystem(toPromptPartners([...LIST].reverse()))).toBe(sys);
  });

  it("the static part does not depend on the row; a tenant without partners still gets a prompt", () => {
    const sys = partnerProposalSystem(LIST);
    const user = partnerProposalUser({
      bookingDate: "2026-07-15",
      amount: "-450.00",
      currency: "SEK",
      counterparty: "BYTEFORM",
      text: "BYTEFORM 2026-07",
    });
    expect(user).toContain("Counterparty: BYTEFORM");
    expect(sys).not.toContain("BYTEFORM");
    expect(partnerProposalSystem([])).toContain("(none yet)");
  });

  it("the answer is bound to the handles: another one does not parse; no partners → only null", () => {
    const schema = partnerProposalSchema(LIST.map((p) => p.ref));
    expect(schema.safeParse(answer({ partner: "p2" })).success).toBe(true);
    expect(schema.safeParse(answer({ partner: "p9" })).success).toBe(false);
    expect(schema.safeParse(answer({ partner: A })).success).toBe(false);
    expect(
      schema.safeParse(
        answer({ newPartner: { name: "Byteform", type: "supplier", country: "SE" } }),
      ).success,
    ).toBe(true);
    expect(
      schema.safeParse(answer({ newPartner: { name: "Byteform", type: "bank", country: null } }))
        .success,
    ).toBe(false);
    const none = partnerProposalSchema([]);
    expect(none.safeParse(answer({})).success).toBe(true);
    expect(none.safeParse(answer({ partner: "p1" })).success).toBe(false);
  });
});

describe("the answer as a payload", () => {
  it("a handle is that partner; a new name already listed is that partner too (folded); else a new partner", () => {
    expect(partnerAnswerPayload(answer({ partner: "p1" }), LIST)).toEqual({ partnerId: A });
    expect(
      partnerAnswerPayload(
        answer({ newPartner: { name: "  cloudhost  ab ", type: "supplier", country: null } }),
        LIST,
      ),
    ).toEqual({ partnerId: A });
    expect(
      partnerAnswerPayload(
        answer({ newPartner: { name: "Byteform", type: "supplier", country: "se" } }),
        LIST,
      ),
    ).toEqual({ newPartner: { name: "Byteform", type: "supplier", country: "SE" } });
    expect(
      partnerAnswerPayload(
        answer({ newPartner: { name: "Byteform", type: "client", country: null } }),
        LIST,
      ),
    ).toEqual({ newPartner: { name: "Byteform", type: "client" } });
  });

  it("nobody named → no payload", () => {
    expect(partnerAnswerPayload(answer({}), LIST)).toBeNull();
  });
});

describe("the facts a partner proposal was made on", () => {
  it("the counterparty and the amount — a new partner in the list or a category on the row changes nothing", () => {
    const row = { counterpartyKey: "BYTEFORM", amount: "-450.00" };
    expect(partnerRowFactsHash(row)).toBe(partnerRowFactsHash({ ...row }));
    expect(partnerRowFactsHash(row)).not.toBe(partnerRowFactsHash({ ...row, amount: "-451.00" }));
    expect(partnerPromptFactsHash()).toBe(partnerPromptFactsHash());
  });
});
