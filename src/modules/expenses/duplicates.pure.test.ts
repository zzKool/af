import { describe, expect, it } from "vitest";
import { dedupeMatches, foldName, isNear } from "./duplicates";
import type { DuplicateMatch } from "./types";

const m = (kind: DuplicateMatch["kind"], confidence: DuplicateMatch["confidence"], id: string) =>
  ({
    kind,
    confidence,
    entityType: "expense",
    entityId: id,
    entityKey: id,
    partnerName: null,
    reason: { key: "x", params: {} },
  }) satisfies DuplicateMatch;

describe("expense duplicates — the pure rules (harvest §4.2)", () => {
  it("near: amount within 1 %, date within 7 days inclusive", () => {
    expect(isNear({ amount: 1000, date: "2026-03-10" }, { amount: 1005, date: "2026-03-15" })).toBe(
      true,
    );
    expect(isNear({ amount: 1000, date: "2026-03-10" }, { amount: 1015, date: "2026-03-15" })).toBe(
      false,
    );
    expect(isNear({ amount: 1000, date: "2026-03-10" }, { amount: 1000, date: "2026-03-17" })).toBe(
      true,
    );
    expect(isNear({ amount: 1000, date: "2026-03-10" }, { amount: 1000, date: "2026-03-18" })).toBe(
      false,
    );
    expect(isNear({ amount: 0, date: "2026-03-10" }, { amount: 0, date: "2026-03-10" })).toBe(
      false,
    );
  });

  it("folds the merchant name", () => {
    expect(foldName("  SBB   CFF ")).toBe("sbb cff");
  });

  it("dedupes by entity, orders high first, keeps five", () => {
    const got = dedupeMatches([
      m("fuzzy", "medium", "a"),
      m("hash", "high", "a"),
      m("hash", "high", "b"),
      ...["c", "d", "e", "f", "g"].map((id) => m("fuzzy", "medium", id)),
    ]);
    expect(got).toHaveLength(5);
    expect(got[0]).toMatchObject({ entityId: "b", confidence: "high" });
    expect(got[1]).toMatchObject({ entityId: "a", kind: "fuzzy" }); // the first strategy that found it wins
    expect(got.map((x) => x.confidence)).toEqual(["high", "medium", "medium", "medium", "medium"]);
  });
});
