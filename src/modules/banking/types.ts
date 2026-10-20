// Public DTOs of the banking module. Plain types only — never Prisma types (constitution §2).
// Decimals travel as strings ("-20000.00"), dates as ISO strings ("2026-07-08").

export type BankAccountRole = "main" | "savings";
export const BANK_ACCOUNT_ROLES: readonly BankAccountRole[] = ["main", "savings"];

export type BankTransactionDto = {
  id: string;
  tenantId: string;
  bankAccountId: string;
  bankImportId: string;
  bookingDate: string;
  amount: string;
  currency: string;
  balance: string | null;
  sender: string | null;
  recipient: string | null;
  name: string | null;
  additionalDetails: string | null;
  message: string | null;
  ownNotes: string | null;
  description: string;
  reference: string | null;
  counterpartyKey: string;
  dedupHash: string;
  occurrence: number;
  rowIndex: number;
  createdAt: Date;
  createdBy: string;
  source: string;
};

export type BankImportDto = {
  id: string;
  tenantId: string;
  bankAccountId: string;
  fileName: string;
  documentId: string | null;
  recordCount: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: string[];
  periodFrom: string | null;
  periodTo: string | null;
  importedAt: Date;
  createdBy: string;
};

/** What the import dialog shows once the file is in. */
export type ImportSummary = BankImportDto & {
  accountLabel: string;
  /** ids of the transactions created by this import (the workbench highlights them) */
  transactionIds: string[];
  /** rules applied on the new rows */
  categorised: number;
};

export type RuleMatchType = "contains" | "starts_with" | "ends_with" | "exact" | "regex";
export const RULE_MATCH_TYPES: readonly RuleMatchType[] = [
  "contains",
  "starts_with",
  "ends_with",
  "exact",
  "regex",
];
export type RuleMatchField =
  | "counterparty_key"
  | "name"
  | "details"
  | "message"
  | "sender"
  | "recipient"
  | "all";
export const RULE_MATCH_FIELDS: readonly RuleMatchField[] = [
  "counterparty_key",
  "name",
  "details",
  "message",
  "sender",
  "recipient",
  "all",
];
export type RuleSource = "manual" | "learned";

export type CategorisationRuleDto = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  matchType: RuleMatchType;
  matchPattern: string;
  matchField: RuleMatchField;
  basCode: string | null;
  partnerId: string | null;
  noDocumentNeeded: boolean;
  priority: number;
  isActive: boolean;
  ruleSource: RuleSource;
  hitCount: number;
  lastHitAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

/** The rule list row: the rule plus joined labels. */
export type RuleListRow = CategorisationRuleDto & {
  partnerName: string | null;
  basLabel: string | null;
};

/** The text of a transaction a rule looks at. */
export type RuleText = {
  counterpartyKey: string;
  name: string | null;
  additionalDetails: string | null;
  message: string | null;
  sender: string | null;
  recipient: string | null;
};

export type RuleTestResult = { matches: number; tested: number; sample: string[] };
export type ApplyRulesResult = {
  dryRun: boolean;
  tested: number;
  applied: number;
  preview: {
    transactionId: string;
    description: string;
    ruleName: string;
    basCode: string | null;
  }[];
};

/** Derived from links and the journal flag — never stored. */
export type TransactionState = "open" | "partial" | "linked" | "no_document";
export const TRANSACTION_STATES: readonly TransactionState[] = [
  "open",
  "partial",
  "linked",
  "no_document",
];

/** The workbench row: the transaction, the journal facts, the derived state. */
export type TransactionListRow = {
  id: string;
  bankAccountId: string;
  accountLabel: string;
  bankImportId: string;
  bookingDate: string;
  description: string;
  counterpartyKey: string;
  amount: string;
  currency: string;
  balance: string | null;
  reference: string | null;
  ownNotes: string | null;
  // journal facts (null when the entry is missing — never the case after an import)
  journalEntryId: string | null;
  amountBase: string | null;
  rate: string | null;
  rateSource: string | null;
  bankImplicitRate: string | null;
  basCode: string | null;
  basLabel: string | null;
  partnerId: string | null;
  partnerName: string | null;
  note: string | null;
  noDocumentNeeded: boolean;
  categorisedBy: string | null;
  // derived
  state: TransactionState;
  allocated: string;
  createdAt: Date;
};

export type TransferProposal = {
  from: { id: string; bookingDate: string; amount: string; currency: string; accountLabel: string };
  to: { id: string; bookingDate: string; amount: string; currency: string; accountLabel: string };
  /** SEK ÷ foreign (1 for same-currency moves), 6 dp */
  implied: string;
  ecb: string | null;
  /** |implied / ecb − 1| as a percentage string ("0.11"); null for same currency */
  deviationPercent: string | null;
  hints: string[];
  confidence: "high" | "medium";
};

export type AccountBalance = {
  bankAccountId: string;
  label: string;
  currency: string;
  role: BankAccountRole;
  balance: string | null;
  balanceDate: string | null;
  lastImportAt: Date | null;
};
