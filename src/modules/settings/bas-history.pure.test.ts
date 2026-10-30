// F125 PR 2: the owner's history per partner, merged across the modules' entries — the picker's *used before*.
import { describe, expect, it } from "vitest";
import { mergeBasUsage, partnerBasSuggestions } from "./bas-history";

describe("mergeBasUsage", () => {
  it("sums one partner's accounts across lists, most used first, ties by code, three at most", () => {
    const merged = mergeBasUsage([
      [
        { partnerId: "p1", basCode: "654", count: 2 },
        { partnerId: "p2", basCode: "653", count: 1 },
      ],
      [
        { partnerId: "p1", basCode: "654", count: 3 },
        { partnerId: "p1", basCode: "580", count: 1 },
        { partnerId: "p1", basCode: "501", count: 1 },
        { partnerId: "p1", basCode: "657", count: 1 },
      ],
    ]);
    expect(merged.p1).toEqual([
      { code: "654", count: 5 },
      { code: "501", count: 1 },
      { code: "580", count: 1 },
    ]);
    expect(merged.p2).toEqual([{ code: "653", count: 1 }]);
    expect(merged.p3).toBeUndefined();
  });
});

describe("partnerBasSuggestions", () => {
  it("the default first, then the history with its reason; the picker drops the repeat", () => {
    expect(
      partnerBasSuggestions({
        defaultCode: "654",
        history: [
          { code: "654", count: 5 },
          { code: "580", count: 1 },
        ],
        historyReason: (n) => `used ${n}×`,
      }),
    ).toEqual([
      { code: "654", source: "partner" },
      { code: "654", source: "history", reason: "used 5×" },
      { code: "580", source: "history", reason: "used 1×" },
    ]);
    expect(partnerBasSuggestions({})).toEqual([]);
  });
});
