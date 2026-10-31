// The model's BAS question for one bank row (F98 PR 2, specs/ai FR-005, spec-suggest-from-first-entry FR-201).
// Pure: the messages and the output schema. Static parts first — the instructions, the tenant's active accounts
// (English, Swedish, the owner's *Use for* note when he wrote one) and his own categorised rows as examples — so
// the server's prompt cache reuses them across rows; the row last.
//
// What the model knows about an account comes from the chart's names and the owner's notes, never from this file:
// no vendor, product or keyword is mapped to an account here (SC-202 — a test greps for it).
import { createHash } from "node:crypto";
import { z } from "zod";

/** Bumped with any change of the text below — logged with every call, part of a proposal's facts. */
export const BAS_PROPOSAL_VERSION = "bas-proposal.v1";
export const BAS_PROPOSAL_TASK = "linking.bas-proposal";

/** An active account as the prompt lists it. */
export type PromptAccount = {
  code: string;
  /** English (the owner's own, else the chart's) */
  name: string;
  /** the chart's Swedish name, when it differs */
  nameSv?: string | null;
  /** the owner's *Use for* note (F126), when there is one */
  useFor?: string | null;
};

export type PromptExample = { text: string; amount: string; currency: string; basCode: string };

export type PromptRow = { bookingDate: string; amount: string; currency: string; text: string };

const SYSTEM = [
  "You categorise one bank transaction of a small Swedish consulting company (aktiebolag) to one BAS account.",
  "Pick the account whose purpose fits what was bought or received. Use only the accounts listed below.",
  "A negative amount is money out (a cost, a purchase, a tax, a transfer out); a positive amount is money in.",
  "Read the notes: they are the owner's own words for what goes on an account and win over the account's name.",
  "The examples are rows the owner categorised himself: follow them for similar rows.",
  "confidence: 0.9 or more only when the text names what was bought and one account clearly fits; 0.6–0.8 when it is",
  "a likely fit; below 0.5 when you are guessing. reason: one short English sentence saying why, no amounts.",
  "alternatives: at most two other accounts that could fit, each with a short why; none when the choice is clear.",
].join("\n");

function accountLine(a: PromptAccount): string {
  const sv = a.nameSv && a.nameSv !== a.name ? ` (${a.nameSv})` : "";
  const note = a.useFor?.trim() ? ` — use for: ${a.useFor.trim()}` : "";
  return `${a.code} ${a.name}${sv}${note}`;
}

/** The static part of the prompt — the same for every row of a run. */
export function basProposalSystem(
  accounts: readonly PromptAccount[],
  examples: readonly PromptExample[],
): string {
  const parts = [SYSTEM, "", "Accounts:", ...accounts.map(accountLine)];
  if (examples.length) {
    parts.push("", "Examples (bank text → account):");
    for (const e of examples) parts.push(`${e.text} | ${e.amount} ${e.currency} → ${e.basCode}`);
  }
  return parts.join("\n");
}

export function basProposalUser(row: PromptRow): string {
  return [
    `Date: ${row.bookingDate}`,
    `Amount: ${row.amount} ${row.currency}`,
    `Bank text: ${row.text || "(none)"}`,
  ].join("\n");
}

/**
 * What the model may answer: a code from the active set (the enum — the server's grammar cannot produce another),
 * a confidence, a reason, up to two alternatives.
 */
export function basProposalSchema(activeCodes: readonly string[]) {
  const code = z.enum(activeCodes as [string, ...string[]]);
  return z.object({
    basCode: code,
    confidence: z.number().min(0).max(1),
    reason: z.string().max(160),
    alternatives: z.array(z.object({ basCode: code, why: z.string().max(160) })).max(2),
  });
}
export type BasProposalAnswer = z.infer<ReturnType<typeof basProposalSchema>>;

/**
 * What the model's answer was made on, beside the row's own facts: the prompt version and the accounts with their
 * notes (not the examples — a new categorised row must not re-ask every open row). A rejected model proposal is
 * not made again while this and the row's facts are unchanged; an edited note asks again.
 */
export function promptFactsHash(accounts: readonly PromptAccount[]): string {
  return createHash("sha256")
    .update(BAS_PROPOSAL_VERSION)
    .update(accounts.map(accountLine).join("\n"))
    .digest("hex")
    .slice(0, 16);
}
