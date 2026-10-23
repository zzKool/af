// Public DTOs of the journal module. Plain types only — never Prisma types (constitution §2).
// Decimals travel as strings ("−20000.00"), dates as ISO strings ("2026-07-08").
import type { BaseRateResult } from "@/modules/rates";

export type JournalSource = "bank_transaction" | "manual";
export const JOURNAL_SOURCES: readonly JournalSource[] = ["bank_transaction", "manual"];

/** A money fact's rate source: the words of rates' `rateToBase` (`same_currency` · `ecb_daily` · `ecb_nearest`)
 * or a rate typed by hand (`manual`). One vocabulary with rates (lessons audit 30): a new source there is one here. */
export type RateSource = BaseRateResult["source"] | "manual";
// a Record so the compiler refuses a list that misses a member of RateSource
const RATE_SOURCE_SET: Record<RateSource, true> = {
  same_currency: true,
  ecb_daily: true,
  ecb_nearest: true,
  manual: true,
};
export const RATE_SOURCES = Object.keys(RATE_SOURCE_SET) as readonly RateSource[];

export type CategorisedBy = "manual" | "rule" | "partner_default";

export type JournalEntryDto = {
  id: string;
  tenantId: string;
  sourceType: JournalSource;
  sourceId: string | null;
  entryDate: string;
  description: string;
  counterpartyKey: string | null;
  amount: string;
  currency: string;
  amountBase: string;
  rate: string;
  rateSource: RateSource;
  rateDate: string | null;
  bankImplicitRate: string | null;
  basCode: string | null;
  partnerId: string | null;
  note: string | null;
  noDocumentNeeded: boolean;
  categorisedBy: CategorisedBy | null;
  ruleId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

/** What the banking import hands over for one new transaction. */
export type BankEntryInput = {
  sourceId: string;
  entryDate: string;
  description: string;
  counterpartyKey: string;
  amount: string;
  currency: string;
};

export type CategoriseInput = {
  basCode?: string | null;
  partnerId?: string | null;
  note?: string | null;
  noDocumentNeeded?: boolean;
};

/** How far an entry is proven by links (T004) — derived, never typed. */
export type LinksState = "justified" | "partly" | "none" | "no_document";
export const LINKS_STATES: readonly LinksState[] = ["none", "partly", "justified", "no_document"];

/** The ledger row: the entry plus the joined labels and the derived links state. */
export type JournalListRow = JournalEntryDto & {
  partnerName: string | null;
  basLabel: string | null;
  linksState: LinksState;
  /** a bank entry's account (*Nordea CHF*) through banking's read API (T006); null for a manual entry */
  accountAlias: string | null;
};

/** The owner's facts a History line names when they changed (the money facts never change). */
export type JournalFact = "basCode" | "partnerId" | "note" | "noDocumentNeeded";
export const JOURNAL_FACTS: readonly JournalFact[] = [
  "basCode",
  "partnerId",
  "note",
  "noDocumentNeeded",
];

/** One line of an entry's History (F71): read from the audit trail, newest first. */
export type JournalHistoryItem = {
  /** ISO timestamp of the write */
  at: string;
  action: "create" | "update" | "delete";
  /** who set the facts on an update: by hand or a rule (`categorised_by` after the write); null on create */
  by: CategorisedBy | null;
  /** the owner's facts this write changed, in JOURNAL_FACTS order; empty on create */
  changed: JournalFact[];
};
