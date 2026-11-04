// The one place banking maps its derived transaction state → the D40 state family (ui-conventions *States*).
// Client-safe (no Prisma): the workbench, the side panel and the inbox's detail view all read it.
//   open                    attention    nothing justifies the row yet — the Months panel counts it "to justify"
//   partial                 progress     some proof, not enough — still "to justify"
//   linked                  done         Σ allocations covers the amount, and the row names a partner (F129, D73)
//   linked_no_partner       attention    covered, but no partner typed or derived — still "to justify"
//   no_document             neutral      the statement is the proof (flag or a transfer leg), a partner named
//   no_document_no_partner  attention    flagged without a partner — still "to justify"
import type { StateFamily } from "@/kernel/ui/state-label";
import type { TransactionState } from "./types";

export const TRANSACTION_STATE_FAMILY: Readonly<Record<TransactionState, StateFamily>> = {
  open: "attention",
  partial: "progress",
  linked: "done",
  linked_no_partner: "attention",
  no_document: "neutral",
  no_document_no_partner: "attention",
};

export function transactionStateFamily(state: TransactionState): StateFamily {
  return TRANSACTION_STATE_FAMILY[state];
}
