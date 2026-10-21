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

// --- suggestions (specs/linking/spec.md FR-001–FR-004) ---

/** Which bank rows pay an entity: receivables are paid by incoming rows, everything else by outgoing ones. */
export type FlowDirection = "incoming" | "outgoing";

/**
 * What the scorer needs to know about an entity — or about a bank row seen from the other side. Supplied by
 * the owning module through `Linkable.facts` / `Linkable.candidates`; the linking module adds `remaining`.
 */
export type EntityFacts = {
  type: LinkableType;
  id: string;
  label: string;
  /** what a link allocates against (absolute), in `currency` */
  amount: string;
  currency: string;
  /** the SEK base both sides already carry (D3) — the cross-currency comparison; null when unknown */
  amountBase: string | null;
  /** ISO date that anchors the ± window: issue date, invoice date, expense date, booking date */
  date: string;
  /** the number or key that may appear in a bank row's text (`VA26-INV-001`, `Ex213-Tr-01`, `9160`) */
  reference: string | null;
  partnerName: string | null;
  /** free text the other side's reference / name is searched in */
  texts: string[];
  /** words of the entity (a receipt's description, a vendor) that may appear in a bank row's text */
  keywords?: string[];
  direction: FlowDirection;
  /** what is still open after the existing allocations (set by the linking module) */
  remaining: string;
};

export type CandidateQuery = {
  direction: FlowDirection;
  /** ISO dates, inclusive */
  dateFrom: string;
  dateTo: string;
  limit: number;
};

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type MatchResult = {
  score: number;
  confidence: Confidence;
  reasons: string[];
  /** a number, key or partner name of the entity was found in the row's text */
  reference: boolean;
  crossCurrency: boolean;
};

export type Suggestion = MatchResult & {
  candidate: EntityFacts;
  /** `min(remaining on the row, remaining on the entity)` in the target currency; null when cross-currency */
  allocation: string | null;
};

export type SkipReason =
  | "NO_CANDIDATES"
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS"
  | "CURRENCY_MISMATCH"
  | "OVER_ALLOCATION"
  | "ALREADY_LINKED";

export type BulkApplyResult = {
  applied: { bankTransactionId: string; to: LinkEndpoint; allocatedAmount: string }[];
  skipped: { bankTransactionId: string; reason: SkipReason; detail: string }[];
  failed: { bankTransactionId: string; message: string }[];
};

// --- graph (specs/linking/spec.md, the read model of constitution §1.2) ---

/** One entity in the neighbourhood of a root. `key` is `type:id`. */
export type GraphNode = {
  key: string;
  type: LinkableType;
  id: string;
  label: string;
  amount: string | null;
  currency: string | null;
  /** hops from the root (0 = the root) */
  depth: number;
  /** the key of the node it was reached from (null for the root) — the tree the picture is drawn along */
  parent: string | null;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: LinkKind;
  allocatedAmount: string | null;
  currency: string | null;
};

export type Graph = {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** true when the depth or the node cap stopped the walk — more exists beyond the last ring */
  truncated: boolean;
};
