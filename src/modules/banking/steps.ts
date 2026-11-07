// The three things a bank row needs (D76, the Pulse banking board): **a proof, a partner, a category** — each one
// done, proposed, partly there, missing or not needed. Derived from what the row already carries (its state, the
// effective partner and category, the current proposal), never stored. The list draws them as three dots, the
// work surface as its three numbered steps; both read this one function. Client-safe, pure.
import type { TransactionState } from "./types";

export type StepStatus = "done" | "proposed" | "partial" | "missing" | "none";
export type StepKey = "proof" | "partner" | "category";

export type RowStepFacts = {
  state: TransactionState;
  /** the effective partner (typed or from the proof) */
  partnerId: string | null;
  /** the effective category */
  basCode: string | null;
  /** a category proposal waits on the row */
  proposedBasCode?: string | null;
  /** a partner proposal waits on the row (the panel knows; the list does not) */
  proposedPartner?: boolean;
};

export type RowSteps = Record<StepKey, StepStatus>;

export const STEP_KEYS: readonly StepKey[] = ["proof", "partner", "category"];

/** the states whose proof is the statement or the flag — no document to attach */
const NO_DOCUMENT: ReadonlySet<TransactionState> = new Set([
  "no_document",
  "no_document_no_partner",
]);

export function rowSteps(f: RowStepFacts): RowSteps {
  const proof: StepStatus =
    f.state === "linked" || f.state === "linked_no_partner"
      ? "done"
      : f.state === "partial"
        ? "partial"
        : NO_DOCUMENT.has(f.state)
          ? "none"
          : "missing";
  // `no_document` without a partner is justified by D73 only for a transfer leg or a savings row (Q3): nobody to name
  const partner: StepStatus = f.partnerId
    ? "done"
    : f.state === "no_document"
      ? "none"
      : f.proposedPartner
        ? "proposed"
        : "missing";
  const category: StepStatus = f.basCode
    ? "done"
    : f.proposedBasCode
      ? "proposed"
      : f.state === "no_document"
        ? "none"
        : "missing";
  return { proof, partner, category };
}

/** how many of the three still need the owner: missing or only partly there (a proposal waits for a click) */
export function missingSteps(steps: RowSteps): number {
  return STEP_KEYS.filter((k) => steps[k] === "missing" || steps[k] === "partial").length;
}

/** what the work surface's one sentence says about the row */
export type RowVerdict = "done" | "no_proof" | "proposed" | "missing";

export function rowVerdict(steps: RowSteps): RowVerdict {
  if (missingSteps(steps) > 0) return "missing";
  if (STEP_KEYS.some((k) => steps[k] === "proposed")) return "proposed";
  if (steps.proof === "none") return "no_proof";
  return "done";
}
