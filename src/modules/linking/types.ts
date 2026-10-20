// Public DTOs of the linking module. Plain types only — never Prisma types (constitution §2).

/** Relationship kinds — the CHECK constraint on `links.kind` mirrors this list. New kinds are a migration. */
export type LinkKind = "justifies" | "transfer" | "settles" | "belongs_to" | "created_from";
export const LINK_KINDS: readonly LinkKind[] = [
  "justifies",
  "transfer",
  "settles",
  "belongs_to",
  "created_from",
];

/**
 * Entity types that can take part in a link. The string is the contract between modules and the link
 * table; a module becomes linkable by registering a `Linkable` for its type (see `linkables.ts`).
 */
export type LinkableType =
  | "document"
  | "partner"
  | "contract"
  | "bank_transaction"
  | "journal_entry"
  | "invoice"
  | "supplier_invoice"
  | "expense"
  | "settlement";

export type LinkEndpoint = { type: LinkableType; id: string };

export type LinkDto = {
  id: string;
  tenantId: string;
  from: LinkEndpoint;
  to: LinkEndpoint;
  kind: LinkKind;
  /** Decimal as string ("1200.00"); null when the link carries no allocation. */
  allocatedAmount: string | null;
  currency: string | null;
  note: string | null;
  createdAt: Date;
  createdBy: string;
  source: string;
};

export type CreateLinkInput = {
  from: LinkEndpoint;
  to: LinkEndpoint;
  kind: LinkKind;
  allocatedAmount?: string | null;
  currency?: string | null;
  note?: string | null;
};

/** What a module exposes about one of its entities to the linking module and the UI. */
export type LinkableSummary = {
  type: LinkableType;
  id: string;
  label: string;
  /** Decimal as string; present only for entities that carry an amount (invoices, transactions, expenses …). */
  amount: string | null;
  currency: string | null;
};

export type AllocationStatus = {
  endpoint: LinkEndpoint;
  amount: string;
  currency: string;
  allocated: string;
  remaining: string;
};
