import { describe, expect, it } from "vitest";
import { createMockOcrService } from "@/kernel/ocr/ocr";
import cases from "../../../specs/documents/fixtures/duplicate-check-cases.json";
import { ocrAddressText, partnerAddressFromOcr } from "./components/ocr-address";
import {
  addressMatches,
  BEST_MATCH_PERCENT,
  editDistance,
  flattenAddress,
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

  it("an OCR payload with a vendor address scores +20 against the partner at that address (T026)", async () => {
    const ocr = await createMockOcrService().analyzeDocument(
      { type: "buffer", buffer: Buffer.from("x"), mimeType: "application/pdf" },
      "invoice",
    );
    if (!ocr.success) throw new Error("mock failed");
    const { vendorName, vendorAddress } = ocr.data;
    // stored as the partner form saves it; JSONB hands the keys back in its own order
    const stored = { city: "Stockholm", street: "Storgatan 1", country: "SE", postalCode: "11122" };
    const partner: MatchablePartner = {
      id: "p",
      name: "Test Vendor AB",
      vatNumber: null,
      address: flattenAddress(stored),
      types: ["vendor"],
    };
    expect(partner.address).toBe("Storgatan 1, 11122 Stockholm, SE");
    const without = scorePartnerMatch({ name: vendorName, type: "vendor" }, partner);
    const withAddress = scorePartnerMatch(
      { name: vendorName, address: ocrAddressText(vendorAddress), type: "vendor" },
      partner,
    );
    expect(without).toBe(90);
    expect(withAddress - without).toBe(20);
    // another street in the same city scores nothing for the address
    const elsewhere = {
      ...partner,
      address: flattenAddress({ ...stored, street: "Storgatan 12" }),
    };
    expect(
      scorePartnerMatch({ name: vendorName, address: ocrAddressText(vendorAddress) }, elsewhere),
    ).toBe(80);
  });

  it("the address rule: contains either way by words, or the partner's street inside the OCR text", () => {
    expect(addressMatches("548 Market St", "548 Market St, San Francisco")).toBe(true);
    expect(addressMatches("Storgatan 1\n111 22 Stockholm", "Storgatan 1, Stockholm")).toBe(true);
    expect(
      addressMatches("Östra Hamngatan 5, Göteborg", "Ostra Hamngatan 5, 411 10 Göteborg"),
    ).toBe(true);
    expect(addressMatches("Storgatan 12, Stockholm", "Storgatan 1, Stockholm")).toBe(false);
    expect(addressMatches("Stockholm", "SE")).toBe(false);
    expect(addressMatches(null, "Storgatan 1")).toBe(false);
  });

  it("Create new partner starts from the OCR address, within the partner schema", () => {
    expect(
      partnerAddressFromOcr({
        street: " Storgatan 1 ",
        postalCode: "111 22",
        city: "Stockholm",
        country: "se",
        text: "Storgatan 1, 111 22 Stockholm",
      }),
    ).toEqual({ street: "Storgatan 1", postalCode: "111 22", city: "Stockholm", country: "SE" });
    expect(partnerAddressFromOcr({ text: "somewhere", country: "SWE" })).toEqual({});
    expect(partnerAddressFromOcr(null)).toEqual({});
    expect(ocrAddressText({ street: "Storgatan 1", postalCode: "111 22", city: "Stockholm" })).toBe(
      "Storgatan 1, 111 22 Stockholm",
    );
    expect(ocrAddressText({})).toBeNull();
  });
});
