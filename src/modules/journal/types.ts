// Public DTOs of the journal module. Plain types only — never Prisma types (constitution §2).
// Decimals travel as strings ("−20000.00"), dates as ISO strings ("2026-07-08").

export type JournalSource = "bank_transaction" | "manual";
export const JOURNAL_SOURCES: readonly JournalSource[] = ["bank_transaction", "manual"];

export type RateSource = "same_currency" | "ecb_daily" | "ecb_nearest" | "manual";
export const RATE_SOURCES: readonly RateSource[] = [
  "same_currency",
  "ecb_daily",
  "ecb_nearest",
  "manual",
];

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

/** The ledger row: the entry plus the joined labels. */
export type JournalListRow = JournalEntryDto & {
  partnerName: string | null;
  basLabel: string | null;
};
