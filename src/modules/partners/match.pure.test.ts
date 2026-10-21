import { describe, expect, it } from "vitest";
import cases from "../../../specs/documents/fixtures/duplicate-check-cases.json";
import {
  BEST_MATCH_PERCENT,
  editDistance,
  type MatchablePartner,
  matchPercent,
  rankPartnerMatches,
  scorePartnerMatch,
} from "./match";

type Fixture = {
  partnerMatch: {
    bestMatchThresholdPercent: number;
    cases: {
      query: { name: string; vatNumber?: string; address?: string; roles?: string[] };
      partner: { name: string; vatNumber?: string; address?: string; roles?: string[] };
      expectScore: number;
      expectPercent?: number;
      excluded?: boolean;
      _note?: string;
    }[];
  };
};

// v1's roles → v3's types: SUPPLIER = vendor, CUSTOMER = client
const toTypes = (roles?: string[]) =>
  (roles ?? []).map((r) => (r === "SUPPLIER" ? "vendor" : r === "CUSTOMER" ? "client" : r));

describe("partner match (harvest R39, specs/documents US1)", () => {
  it("scores the harvest's cases", () => {
    const { partnerMatch } = cases as unknown as Fixture;
    expect(partnerMatch.bestMatchThresholdPercent).toBe(BEST_MATCH_PERCENT);
    for (const c of partnerMatch.cases) {
      const partner: MatchablePartner = {
        id: "p",
        name: c.partner.name,
        vatNumber: c.partner.vatNumber ?? null,
        address: c.partner.address ?? null,
        types: toTypes(c.partner.roles),
      };
      const score = scorePartnerMatch(
        {
          name: c.query.name,
          vatNumber: c.query.vatNumber,
          address: c.query.address,
          type: toTypes(c.query.roles)[0] as "vendor" | undefined,
        },
        partner,
      );
      expect(score, `${c.query.name} vs ${c.partner.name}`).toBe(c.expectScore);
      if (c.expectPercent != null) expect(matchPercent(score)).toBe(c.expectPercent);
      const ranked = rankPartnerMatches({ name: c.query.name, vatNumber: c.query.vatNumber }, [
        partner,
      ]);
      if (c.excluded) expect(ranked).toEqual([]);
    }
  });

  it("ranks best first, drops zeros, keeps five", () => {
    const partners: MatchablePartner[] = [
      {
        id: "a",
        name: "Skattepunkten AB",
        vatNumber: "SE556677889901",
        address: null,
        types: ["vendor"],
      },
      { id: "b", name: "Skatteverket", vatNumber: null, address: null, types: ["vendor"] },
      { id: "c", name: "Nordea Bank Abp", vatNumber: null, address: null, types: ["vendor"] },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `s${i}`,
        name: `Skattepunkten ${i}`,
        vatNumber: null,
        address: null,
        types: ["vendor"],
      })),
    ];
    const ranked = rankPartnerMatches(
      { name: "skattepunkten ab", vatNumber: "SE 5566 7788-9901", type: "vendor" },
      partners,
    );
    expect(ranked[0]).toMatchObject({ partnerId: "a", score: 190, percent: 100 });
    expect(ranked).toHaveLength(5);
    expect(ranked.some((m) => m.partnerId === "c")).toBe(false);
  });

  it("edit distance caps early", () => {
    expect(editDistance("nordea bank abp", "nordea bank abq")).toBe(1);
    expect(editDistance("abc", "abcdefg")).toBe(4); // beyond the cap → max + 1
    expect(editDistance("same", "same")).toBe(0);
  });
});
