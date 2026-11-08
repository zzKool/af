// F125 PR 2: the owner's history per partner, merged across the modules' entries — the picker's *used before*.
import { describe, expect, it } from "vitest";
import { mergeBasUsage, partnerBasSuggestions } from "./bas-history";

describe("mergeBasUsage", () => {
  it("sums one partner's accounts across lists, most used first, ties by code, three at most", () => {
    const merged = mergeBasUsage([
      [
        { partnerId: "p1", basCode: "6540", count: 2 },
        { partnerId: "p2", basCode: "6530", count: 1 },
      ],
      [
        { partnerId: "p1", basCode: "6540", count: 3 },
        { partnerId: "p1", basCode: "5800", count: 1 },
        { partnerId: "p1", basCode: "5010", count: 1 },
        { partnerId: "p1", basCode: "6570", count: 1 },
      ],
    ]);
    expect(merged.p1).toEqual([
      { code: "6540", count: 5 },
      { code: "5010", count: 1 },
      { code: "5800", count: 1 },
    ]);
    expect(merged.p2).toEqual([{ code: "6530", count: 1 }]);
    expect(merged.p3).toBeUndefined();
  });
});

describe("partnerBasSuggestions", () => {
  it("the default first, then the history with its reason; the picker drops the repeat", () => {
    expect(
      partnerBasSuggestions({
        defaultCode: "6540",
        history: [
          { code: "6540", count: 5 },
          { code: "5800", count: 1 },
        ],
        historyReason: (n) => `used ${n}×`,
      }),
    ).toEqual([
      { code: "6540", source: "partner" },
      { code: "6540", source: "history", reason: "used 5×" },
      { code: "5800", source: "history", reason: "used 1×" },
    ]);
    expect(partnerBasSuggestions({})).toEqual([]);
  });
});
