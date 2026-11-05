// The band of a DI confidence (F127): `·` ≥ 0.90 · `?` 0.70–0.90 · `!` < 0.70 — tested at the boundaries.
import { describe, expect, it } from "vitest";
import { CONFIDENCE_GLYPH, confidenceLabel } from "./confidence";

describe("confidenceLabel", () => {
  it.each([
    [1, "high"],
    [0.9, "high"],
    [0.8999, "medium"],
    [0.81, "medium"],
    [0.7, "medium"],
    [0.6999, "low"],
    [0.41, "low"],
    [0, "low"],
  ] as const)("%s → %s", (confidence, band) => {
    expect(confidenceLabel(confidence)).toBe(band);
  });

  it("is null when there is no confidence to band (an old reading, a field DI gave none for)", () => {
    expect(confidenceLabel(null)).toBeNull();
    expect(confidenceLabel(undefined)).toBeNull();
    expect(confidenceLabel(Number.NaN)).toBeNull();
  });

  it("the screen's glyph per band", () => {
    expect(CONFIDENCE_GLYPH).toEqual({ high: "·", medium: "?", low: "!" });
  });
});
