// The one place banking maps its derived transaction state → the D40 state family (ui-conventions *States*).
// Client-safe (no Prisma): the workbench, the side panel and the inbox's detail view all read it.
//   open         attention    nothing justifies the row yet — the Months panel counts it "to justify"
//   partial      progress     some proof, not enough — still "to justify"
//   linked       done         Σ allocations covers the amount
//   no_document  neutral      the statement is the proof (flag or a transfer leg)
import type { StateFamily } from "@/kernel/ui/state-label";
import type { TransactionState } from "./types";

export const TRANSACTION_STATE_FAMILY: Readonly<Record<TransactionState, StateFamily>> = {
  open: "attention",
  partial: "progress",
  linked: "done",
  no_document: "neutral",
};

export function transactionStateFamily(state: TransactionState): StateFamily {
  return TRANSACTION_STATE_FAMILY[state];
}
