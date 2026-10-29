// Stage 1 and its policy (F98, specs/ai FR-004, FR-006) — invented rows.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ProposalInput } from "@/modules/banking";
import { factsHash } from "./facts-hash";
import { parsePayload } from "./payload";
import { familyOf, isPrefilled, isShown, memoryConfidence } from "./policy";
import { fromMemory, stage1 } from "./stage1";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function input(
  over: Partial<Omit<ProposalInput, "row">> & { row?: Partial<ProposalInput["row"]> } = {},
): ProposalInput {
  return {
    row: {
      id: "33333333-3333-4333-8333-333333333333",
      bookingDate: "2026-07-28",
      amount: "-132.52",
      currency: "SEK",
      counterpartyKey: "CLOUDHOST AB",
      text: "CLOUDHOST AB",
      basCode: null,
      partnerId: null,
      categorisedBy: null,
      ...over.row,
    },
    rule: over.rule ?? null,
    partnerDefault: over.partnerDefault ?? null,
    memory: over.memory ?? { bas: [], partner: [] },
  };
}

describe("stage1", () => {
  it("US1: two rows set by hand → the category and the partner, remembered, HIGH", () => {
    const drafts = stage1(
      input({ memory: { bas: [{ code: "654", n: 2 }], partner: [{ id: P1, n: 2 }] } }),
    );
    expect(drafts).toEqual([
      {
        kind: "bas",
        payload: { basCode: "654", alternatives: [] },
        source: "memory",
        confidence: 0.8,
        reason: "Set by hand on 2 rows of this counterparty",
      },
      {
        kind: "partner",
        payload: { partnerId: P1 },
        source: "memory",
        confidence: 0.8,
        reason: "Set by hand on 2 rows of this counterparty",
      },
    ]);
    expect(familyOf(0.8)).toBe("high");
  });

  it("one row is not a memory; a split history (< 70 %) is not either", () => {
    expect(stage1(input({ memory: { bas: [{ code: "654", n: 1 }], partner: [] } }))).toEqual([]);
    expect(
      stage1(
        input({
          memory: {
            bas: [
              { code: "654", n: 2 },
              { code: "659", n: 2 },
            ],
            partner: [],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("a rule made after the import comes first, at 1.00", () => {
    const [d] = stage1(
      input({ rule: { ruleId: "r", ruleName: "CLOUDHOST", basCode: "654", partnerId: null } }),
    );
    expect(d).toMatchObject({
      kind: "bas",
      source: "rule",
      confidence: 1,
      reason: "Rule “CLOUDHOST”",
    });
  });

  it("the partner's default when the row has a partner and no category; no partner proposal then", () => {
    const drafts = stage1(input({ row: { partnerId: P1 }, partnerDefault: "583" }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: "bas", source: "partner_default", confidence: 0.95 });
  });

  it("sources that disagree: the first wins, capped under HIGH, the other an alternative", () => {
    const [d] = stage1(
      input({
        row: { partnerId: P1 },
        partnerDefault: "583",
        memory: { bas: [{ code: "654", n: 5 }], partner: [] },
      }),
    );
    expect(d).toMatchObject({
      kind: "bas",
      source: "partner_default",
      confidence: 0.79,
      payload: { basCode: "583", alternatives: [{ basCode: "654" }] },
    });
    expect(familyOf(d.confidence)).toBe("medium");
  });

  it("a row with both facts gets nothing", () => {
    expect(
      stage1(
        input({
          row: { basCode: "654", partnerId: P2 },
          memory: { bas: [{ code: "659", n: 9 }], partner: [{ id: P1, n: 9 }] },
        }),
      ),
    ).toEqual([]);
  });

  it("every draft's payload reads back through its parser", () => {
    for (const d of stage1(
      input({
        rule: { ruleId: "r", ruleName: "X", basCode: "654", partnerId: P1 },
        memory: { bas: [{ code: "659", n: 3 }], partner: [{ id: P2, n: 3 }] },
      }),
    ))
      expect(parsePayload(d.kind, d.payload)).not.toBeNull();
  });
});

describe("policy", () => {
  it("the families' edges", () => {
    expect(familyOf(1)).toBe("high");
    expect(familyOf(0.8)).toBe("high");
    expect(familyOf(0.79)).toBe("medium");
    expect(familyOf(0.55)).toBe("medium");
    expect(familyOf(0.54)).toBe("low");
    expect(isShown(0.54)).toBe(false);
    expect(isPrefilled(0.95, true)).toBe(true);
    expect(isPrefilled(0.95, false)).toBe(false);
    expect(isPrefilled(0.7, true)).toBe(false);
  });

  it("property: any single stage-1 source alone is HIGH; a disagreement is never HIGH", () => {
    const code = fc.constantFrom("654", "659", "583", "657");
    fc.assert(
      fc.property(code, code, fc.integer({ min: 2, max: 40 }), (a, b, n) => {
        const alone = stage1(input({ memory: { bas: [{ code: a, n }], partner: [] } }));
        expect(familyOf(alone[0].confidence)).toBe("high");
        const both = stage1(
          input({
            row: { partnerId: P1 },
            partnerDefault: a,
            memory: { bas: [{ code: b, n }], partner: [] },
          }),
        );
        if (a !== b) expect(familyOf(both[0].confidence)).not.toBe("high");
        else expect(familyOf(both[0].confidence)).toBe("high");
      }),
    );
  });

  it("property: the memory's confidence grows with N and never reaches 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 1000 }), (n) => {
        expect(memoryConfidence(n)).toBeGreaterThanOrEqual(0.8);
        expect(memoryConfidence(n)).toBeLessThanOrEqual(0.95);
        expect(memoryConfidence(n + 1)).toBeGreaterThanOrEqual(memoryConfidence(n));
      }),
    );
  });

  it("fromMemory: the top value, with its count and the total", () => {
    expect(
      fromMemory([
        { value: "654", n: 3 },
        { value: "659", n: 1 },
      ]),
    ).toEqual({ value: "654", n: 3, total: 4 });
    expect(fromMemory([])).toBeNull();
  });
});

describe("factsHash", () => {
  it("changes with any fact, not otherwise", () => {
    const row = {
      basCode: null,
      partnerId: null,
      counterpartyKey: "CLOUDHOST AB",
      amount: "-132.52",
    };
    expect(factsHash(row)).toBe(factsHash({ ...row }));
    expect(factsHash(row)).not.toBe(factsHash({ ...row, partnerId: P1 }));
    expect(factsHash(row)).not.toBe(factsHash({ ...row, amount: "-132.53" }));
    expect(factsHash(row)).toMatch(/^[0-9a-f]{64}$/);
  });
});
