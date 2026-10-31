// The model's question for the *Use for* notes (F126, FR-202): for a batch of the tenant's active BAS accounts, one
// short English line each — what a small Swedish consulting company books there, and what it does not. Pure. The
// owner reads every draft before it counts as his; nothing here names a vendor or maps one to an account.
import { z } from "zod";
import type { AiMessage } from "@/kernel/ai/types";

export const BAS_USE_FOR_VERSION = "bas-use-for.v1";
export const BAS_USE_FOR_TASK = "settings.bas-use-for";

export type UseForAccount = {
  code: string;
  /** English (the owner's own, else the chart's) */
  name: string;
  /** the chart's Swedish name */
  nameSv: string;
  /** the chart's class heading, Swedish */
  className: string;
};

const SYSTEM = [
  "You help the owner of a small Swedish consulting company (aktiebolag, one person, IT consulting, invoices in",
  "SEK, EUR and CHF) understand the BAS chart of accounts. He does not read Swedish.",
  "For each account below, write one short English line (at most 200 characters): what this company typically",
  "books there, described by kind of purchase or income, and — when it helps — what belongs on a neighbouring",
  "account instead (name that account by its number only if it is in the list).",
  "Plain words, no Swedish, no tax advice, no brand or company names.",
].join("\n");

export function basUseForMessages(accounts: readonly UseForAccount[]): AiMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: accounts
        .map((a) => `${a.code} ${a.name} (Swedish: ${a.nameSv}; class: ${a.className})`)
        .join("\n"),
    },
  ];
}

export function basUseForSchema(codes: readonly string[]) {
  return z.object({
    notes: z
      .array(
        z.object({ code: z.enum(codes as [string, ...string[]]), useFor: z.string().max(300) }),
      )
      .max(codes.length),
  });
}
