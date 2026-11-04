// The one FX tolerance per kind of bank row (F130, review 2026-10-31 §4, O4): how far the bank's amount may sit
// from a paper in another currency converted at the ECB rate of the booking date — before the consistency check
// warns, and before the scorer drops a cross-currency candidate. Decimal strings, like the kernel's other figures.
//
//   card   0.04   a card purchase (`Kortköp`): the card scheme's margin on the ECB rate and a possible fee (O4)
//   other  0.06   every other row: the scorer's cross-currency figure (harvest R6, D67), moved here unchanged —
//                 lowering it changes which suggestions are HIGH, a question of its own
//
// Not a seventh tolerance: the settlement tolerance (`settlement.ts`, D25) stays the rule for *paid* / *settled*;
// the transfer pair's 5 % on the rate stays banking's own.

export type FxToleranceKind = "card" | "other";

const FX_TOLERANCE: Record<FxToleranceKind, string> = { card: "0.04", other: "0.06" };

/** The share of the converted amount the bank may differ by, as a decimal string (`"0.04"` = 4 %). */
export function fxTolerance(kind: FxToleranceKind): string {
  return FX_TOLERANCE[kind];
}
