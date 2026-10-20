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
  // what a document became (D27): the expense or supplier invoice created from a reviewed document.
  // One origin per document and one document per entity — partial unique indexes in the migration.
  created_from: { from: ["expense", "supplier_invoice"], to: ["document"] },
};

export function isKindAllowed(kind: LinkKind, from: LinkableType, to: LinkableType): boolean {
  const pair = MATRIX[kind];
  return pair !== undefined && pair.from.includes(from) && pair.to.includes(to);
}

/** Kinds that carry an allocated amount against the `to` entity's amount. */
export const ALLOCATING_KINDS: readonly LinkKind[] = ["justifies", "settles"];

/** Kinds where each endpoint may take part in at most one link of that kind (one origin, one outcome). */
export const EXCLUSIVE_KINDS: readonly LinkKind[] = ["created_from"];
