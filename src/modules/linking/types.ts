// Public DTOs of the linking module. Plain types only — never Prisma types (constitution §2).

import type { ParsedPayload, ProposalSourceName } from "./proposals/payload";

/** Relationship kinds — the CHECK constraint on `links.kind` mirrors this list. New kinds are a migration. */
export type LinkKind =
  | "justifies"
  | "transfer"
  | "settles"
  | "belongs_to"
  | "created_from"
  | "occurrence_of";
export const LINK_KINDS: readonly LinkKind[] = [
  "justifies",
  "transfer",
  "settles",
  "belongs_to",
  "created_from",
  "occurrence_of",
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
  | "invoice"
  | "supplier_invoice"
  | "expense"
  | "subscription";

export type LinkEndpoint = { type: LinkableType; id: string };

export type LinkDto = {
  id: string;
  tenantId: string;
  from: LinkEndpoint;
  to: LinkEndpoint;
  kind: LinkKind;
  /** Decimal as string ("1200.00"), in the TARGET entity's currency — what part of it this link pays; null when the link carries no allocation. */
  allocatedAmount: string | null;
  currency: string | null;
  /** what the bank row gave for it, in the tenant's base (F114, D60); null together with `allocatedAmount` */
  allocatedBase: string | null;
  note: string | null;
  createdAt: Date;
  createdBy: string;
  source: string;
};

export type CreateLinkInput = {
  from: LinkEndpoint;
  to: LinkEndpoint;
  kind: LinkKind;
  /** in the target's currency (the default); the row's own currency when it differs is a cross-currency payment */
  allocatedAmount?: string | null;
  currency?: string | null;
  /**
   * the base the row gives for this allocation; omitted = the row's base pro rata (same currency; the link that
   * exhausts the row takes the exact remainder) or the row's whole remaining base (cross-currency)
   */
  allocatedBase?: string | null;
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
  /** the base the entity carries (absolute); a bank row's is the capacity its allocations' bases are checked against */
  amountBase?: string | null;
};

export type AllocationStatus = {
  endpoint: LinkEndpoint;
  amount: string;
  currency: string;
  allocated: string;
  remaining: string;
  /** Σ `allocated_base` of the links onto (or from) the endpoint */
  allocatedBase: string;
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
  /**
   * null = not known (a receipt OCR read no currency on, F61-b): the scorer compares no amount and charges no
   * currency penalty — reference, name and date only — and a link to it carries no allocation.
   */
  currency: string | null;
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
  /** the partner the entity belongs to — what the counterparty memory counts (F116) */
  partnerId?: string | null;
  /** the BAS account the entity carries (an expense, a supplier invoice) — what a row it justifies shows on read (F129, D73) */
  basCode?: string | null;
  /** ISO due date of an entity with terms — its payment window and the date claim run to it (F116) */
  dueDate?: string | null;
  /** a bank row's counterparty key — the identity its memory is kept under (F116) */
  counterpartyKey?: string | null;
  direction: FlowDirection;
  /** what is still open after the existing allocations (set by the linking module) */
  remaining: string;
};

export type CandidateQuery = {
  direction: FlowDirection;
  /** ISO dates, inclusive — the span an entity dated once may lie in (the rows' span ± its window) */
  dateFrom: string;
  dateTo: string;
  /**
   * The rows' booking span (F116): an entity with terms is a candidate while a row in the span can still pay it —
   * issued no later than `bookedTo + 5`, due no sooner than `bookedFrom − 10` (or issued within 60 days of it).
   */
  bookedFrom?: string;
  bookedTo?: string;
  /** tokens of the rows' text: an entity whose number is among them is a candidate whatever its date */
  references?: readonly string[];
  /** partners the counterparty memory remembers: their open entities are candidates whatever their date */
  partnerIds?: readonly string[];
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
  allocatedBase: string | null;
};

export type Graph = {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** true when the depth or the node cap stopped the walk — more exists beyond the last ring */
  truncated: boolean;
};

// --- proposals (F98, specs/ai) ---

/** How far a proposal's confidence goes on screen (`proposals/policy.ts`). */
export type ProposalFamily = "high" | "medium" | "low";

/** A current proposal, as the panel, the inbox and the list read it. */
export type ProposalDto = {
  id: string;
  runId: string;
  targetId: string;
  source: ProposalSourceName;
  confidence: number;
  family: ProposalFamily;
  /** HIGH and PREFILL_HIGH: the picker shows it as its value — drawn as a proposal, never saved until accepted */
  prefilled: boolean;
  reason: string | null;
  model: string | null;
  createdAt: string;
} & ParsedPayload;

// --- the consistency checks of a proof (F130, review 2026-10-31 §4; `check-proof.ts`) ---

/** The seven checks, one code each — what a confirmed warning is written as on the link's audit row. */
export type WarningCode =
  | "vendor_counterparty"
  | "amount_fx"
  | "amount_same"
  | "date"
  | "billed_to"
  | "already_proof"
  | "currency_unread";
export const WARNING_CODES: readonly WarningCode[] = [
  "vendor_counterparty",
  "amount_fx",
  "amount_same",
  "date",
  "billed_to",
  "already_proof",
  "currency_unread",
];

/** Which date a date warning counts from: the paper's date (a card row), the invoice date or the due date. */
export type DateAnchor = "paper" | "invoice" | "due";

/**
 * One warning: a code and the facts its sentence needs (`warningMessage`) — the numbers and the names, never a
 * verdict. Amounts are 2-dp decimal strings as the DTOs carry them; dates ISO days.
 */
export type ProofWarning =
  | {
      code: "vendor_counterparty";
      facts: { vendorName: string; counterpartyKey: string };
    }
  | {
      code: "amount_fx";
      facts: {
        readingAmount: string;
        readingCurrency: string;
        rowAmount: string;
        rowCurrency: string;
        bookingDate: string;
        /** the ECB rate of the booking date, reading → row currency; null = none stored, nothing compared */
        rate: string | null;
        /** the reading at that rate, in the row's currency */
        converted: string | null;
        /** (bank − converted) / converted × 100, one decimal, signed (`"3.5"`, `"-2.1"`) */
        offPct: string | null;
        /** the share that applied, in percent (`"4"` on a card row, `"6"` elsewhere) */
        tolerancePct: string;
        kind: "card" | "other";
      };
    }
  | {
      code: "amount_same";
      facts: {
        readingAmount: string;
        rowAmount: string;
        currency: string;
        /** bank − paper, signed */
        difference: string;
      };
    }
  | {
      code: "date";
      facts: {
        days: number;
        when: "before" | "after";
        anchor: DateAnchor;
        anchorDate: string;
        bookingDate: string;
      };
    }
  | {
      code: "billed_to";
      facts: { companyName: string; billedTo: string | null };
    }
  | {
      code: "already_proof";
      facts: { rowDate: string | null; invoiceNumber: string | null };
    }
  | {
      code: "currency_unread";
      facts: { readingAmount: string; rowAmount: string; rowCurrency: string };
    };

/** The partner the dialog matched or the owner picked — what the vendor check compares the paper with. */
export type ProofPartner = { id: string; name: string; vatNumber: string | null };

/** The facts `checkProof` needs from the server (`proofFacts`, F131): the dialog reads them, the comparison stays pure. */
export type ProofFacts = {
  /** the ECB rate reading → row currency on the booking date; null when none is stored or the currencies agree */
  fxRate: string | null;
  fxRateDate: string | null;
  /** D53: true / false when the paper names a customer, null when it names none (or no profile exists) */
  billedToFits: boolean | null;
  companyName: string;
  /** the partners the active rules name for the counterparty key (D74) */
  rulePartnerIds: string[];
  /** `memoryForRow`: the partners this key was linked to before, most first */
  memory: { partnerId: string; name: string; count: number }[];
  /** the other row this document already justifies, if any */
  documentJustifiesOther: { rowDate: string } | null;
  /** the picked supplier holds the invoice number already (D35) */
  supplierNumberTaken: boolean;
};
