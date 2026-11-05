// The band a DI confidence falls in (F127, review 2026-10-31 §3): the screen draws it as `·` / `?` / `!`, the
// accessible name says it in words. Pure, client-safe, no imports.

export type ConfidenceBand = "high" | "medium" | "low";

export const CONFIDENCE_HIGH = 0.9;
export const CONFIDENCE_MEDIUM = 0.7;

/** `high` ≥ 0.90 · `medium` 0.70–0.90 · `low` < 0.70 · null when there is no confidence to band. */
export function confidenceLabel(confidence: number | null | undefined): ConfidenceBand | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (confidence >= CONFIDENCE_HIGH) return "high";
  if (confidence >= CONFIDENCE_MEDIUM) return "medium";
  return "low";
}

/** The glyph of a band, the screen's: `·` high, `?` medium, `!` low. */
export const CONFIDENCE_GLYPH: Record<ConfidenceBand, string> = {
  high: "·",
  medium: "?",
  low: "!",
};
