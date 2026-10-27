// The facts a proposal was made on (F98, specs/ai FR-007, US4): a rejected proposal is not made again while the
// row's category, partner, counterparty and amount are what they were. Pure.
import { createHash } from "node:crypto";

export function factsHash(row: {
  basCode: string | null;
  partnerId: string | null;
  counterpartyKey: string;
  amount: string;
}): string {
  return createHash("sha256")
    .update([row.basCode ?? "", row.partnerId ?? "", row.counterpartyKey, row.amount].join("␟"))
    .digest("hex");
}
