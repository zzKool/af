// Which (from, to) pairs each link kind accepts. Data, not code — extend here when a new linkable arrives.
import type { LinkableType, LinkKind } from "./types";

type Pair = { from: readonly LinkableType[]; to: readonly LinkableType[] };

const MATRIX: Record<LinkKind, Pair> = {
  // a money movement is justified by a document or a document-like entity
  justifies: {
    from: ["bank_transaction", "journal_entry"],
    to: ["document", "invoice", "supplier_invoice", "expense"],
  },
  // two own-account transactions justify each other (CHANGE CHFSEK)
  transfer: { from: ["bank_transaction"], to: ["bank_transaction"] },
  // a refund transaction settles an owner reimbursement
  settles: { from: ["bank_transaction"], to: ["settlement"] },
  // a document belongs to a partner or a contract (NDA, contract PDF, supplier invoice scan …)
  belongs_to: {
    from: ["document", "invoice", "supplier_invoice", "expense"],
    to: ["partner", "contract"],
  },
};

export function isKindAllowed(kind: LinkKind, from: LinkableType, to: LinkableType): boolean {
  const pair = MATRIX[kind];
  return pair !== undefined && pair.from.includes(from) && pair.to.includes(to);
}

/** Kinds that carry an allocated amount against the `to` entity's amount. */
export const ALLOCATING_KINDS: readonly LinkKind[] = ["justifies", "settles"];
