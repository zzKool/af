// What a proposal's confidence means on screen (F98, specs/ai FR-006 + the owner's answers of 2026-10-27).
// Pure constants and functions — moved by evidence (`npm run ai -- eval`), never by a settings page.

import type { ProposalFamily } from "../types";

export type { ProposalFamily };

/** HIGH from here: pre-filled (when PREFILL_HIGH), one key accepts. */
export const HIGH_AT = 0.8;
/** MEDIUM from here: shown with its alternatives, never pre-filled. Below: not shown at all. */
export const MEDIUM_AT = 0.55;

/**
 * The owner's answer 2 (2026-10-27): HIGH proposals are pre-filled in the Category picker, for now — he may switch
 * back to "shown above, never pre-filled". One constant, no setting; the UI draws a pre-filled value as a
 * proposal (not saved) either way.
 */
export const PREFILL_HIGH = true;

export function familyOf(confidence: number): ProposalFamily {
  if (confidence >= HIGH_AT) return "high";
  if (confidence >= MEDIUM_AT) return "medium";
  return "low";
}

/** Shown at all: LOW proposals are kept (for the eval) but not shown. */
export function isShown(confidence: number): boolean {
  return familyOf(confidence) !== "low";
}

export function isPrefilled(confidence: number, prefillHigh = PREFILL_HIGH): boolean {
  return prefillHigh && familyOf(confidence) === "high";
}

/** Two sources that disagree are never HIGH: the chosen one is capped just under the line. */
export const DISAGREEMENT_CAP = 0.79;

/**
 * The history's weight: N rows set by hand, agreeing at least 70 % — 0.6 + 0.1 · N, at most 0.95 (two rows → 0.80,
 * HIGH). Fewer than two, or less agreement, is no memory.
 */
export const MEMORY_MIN_ROWS = 2;
export const MEMORY_MIN_SHARE = 0.7;

export function memoryConfidence(n: number): number {
  return Math.min(0.6 + 0.1 * n, 0.95);
}

export const RULE_CONFIDENCE = 1;
export const PARTNER_DEFAULT_CONFIDENCE = 0.95;

/** What a form pre-fills without saving: the HIGH proposals (`prefilled`, PREFILL_HIGH) — one value per fact. */
export function prefillFromProposals(
  proposals: readonly {
    prefilled: boolean;
    kind: "bas" | "partner";
    payload: { basCode?: string; partnerId?: string } | Record<string, unknown>;
  }[],
): { basCode?: string; partnerId?: string } {
  const out: { basCode?: string; partnerId?: string } = {};
  for (const p of proposals) {
    if (!p.prefilled) continue;
    if (p.kind === "bas" && typeof p.payload.basCode === "string") out.basCode = p.payload.basCode;
    if (p.kind === "partner" && typeof p.payload.partnerId === "string")
      out.partnerId = p.payload.partnerId;
  }
  return out;
}
