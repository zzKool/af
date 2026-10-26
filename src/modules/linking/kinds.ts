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
  // which subscription an expense / supplier invoice is a period of (F94, D57). One subscription per entity —
  // a partial unique index in the migration. An attribution, not proof: it never allocates and never justifies.
  occurrence_of: { from: ["expense", "supplier_invoice"], to: ["subscription"] },
};

export function isKindAllowed(kind: LinkKind, from: LinkableType, to: LinkableType): boolean {
  const pair = MATRIX[kind];
  return pair !== undefined && pair.from.includes(from) && pair.to.includes(to);
}

/** Kinds that carry an allocated amount against the `to` entity's amount. */
export const ALLOCATING_KINDS: readonly LinkKind[] = ["justifies", "settles"];

/** Kinds where each endpoint may take part in at most one link of that kind (one origin, one outcome). */
export const EXCLUSIVE_KINDS: readonly LinkKind[] = ["created_from", "occurrence_of"];

/**
 * Which side of an exclusive kind is exclusive: `created_from` both (a document becomes one thing, an entity has
 * one origin); `occurrence_of` the entity only (an entity is the period of one subscription; a subscription has
 * many periods). The partial unique indexes in the migrations say the same.
 */
export const EXCLUSIVE_SIDES: Readonly<Partial<Record<LinkKind, "both" | "from">>> = {
  created_from: "both",
  occurrence_of: "from",
};

/**
 * Entities whose payments their own module writes (D37, F58): the bank row's amount, base and rate land on the
 * entity together with the `justifies` link (*attach* / *record payment*), and come off with it (*detach* /
 * *remove payment*). Linking's generic paths (inbox apply, *Link to…*, *Unlink*) refuse a `justifies` onto
 * them — the inbox opens the entity's panel instead. The owning module passes `{ owner }` to write.
 */
export const OWN_PAYMENT_FLOW: readonly LinkableType[] = ["expense", "supplier_invoice"];

/** True when a `kind` link onto `to` must go through `to`'s own module. */
export function needsOwnFlow(kind: LinkKind, to: LinkableType): boolean {
  return kind === "justifies" && OWN_PAYMENT_FLOW.includes(to);
}
