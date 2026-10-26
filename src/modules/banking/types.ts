// Public DTOs of the banking module. Plain types only — never Prisma types (constitution §2).
// Decimals travel as strings ("-20000.00"), dates as ISO strings ("2026-07-08").

import type { CategorisedBy } from "@/modules/journal";
import type { LinkableType, LinkKind } from "@/modules/linking";
import type { BankFormatConfig } from "./csv-parser";

export type BankAccountRole = "main" | "savings";
export const BANK_ACCOUNT_ROLES: readonly BankAccountRole[] = ["main", "savings"];

/** A bank CSV format — app-level reference data (no tenant): its conventions and the parsed column mapping. */
export type BankFormatDto = {
  id: string;
  name: string;
  bankName: string;
  delimiter: string;
  decimalSeparator: string;
  dateFormat: string;
  encoding: string;
  /** `parseColumnMapping` of the stored JSON; null when it does not parse (lessons audit 29) */
  columnMapping: BankFormatConfig["columnMapping"] | null;
};

/** A bank account of the tenant with its format and its import count. */
export type BankAccountDto = {
  id: string;
  accountAlias: string | null;
  accountNumber: string;
  currency: string;
  bankFormatId: string;
  role: BankAccountRole;
  iban: string | null;
  bic: string | null;
  /** CSV imports into this account — number and currency are locked when > 0 (F65) */
  imports: number;
  bankFormat: BankFormatDto;
  createdAt: Date;
  updatedAt: Date;
};

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

/**
 * A row's derived state with the facts it derives from — what another module reads instead of re-deriving the
 * allocation and the transfer from the links itself (the package's bank sheet, lessons audit 23).
 */
export type TransactionStateFacts = {
  state: TransactionState;
  /** Σ allocated FROM the row, 2 dp ("0.00" when none) */
  allocated: string;
  /** the row is a leg of an accepted transfer pair */
  inTransfer: boolean;
};

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

/** An outgoing row on a main account — the pickers' starting list (`outgoingMainRows`, read by expenses and supplier invoices). */
export type OutgoingMainRow = {
  id: string;
  bookingDate: string;
  amount: string;
  currency: string;
  description: string;
  bankAccountId: string;
  accountLabel: string;
  /** the journal entry's base, null before the row has one */
  amountBase: string | null;
};

/** An outgoing row inside a date window with what a matcher reads (`outgoingRowsInWindow`, F94). Amounts absolute. */
export type WindowRow = {
  id: string;
  bankAccountId: string;
  bookingDate: string;
  /** |amount|, 2 dp */
  amount: string;
  currency: string;
  /** |the journal entry's base|, null before the row has one */
  amountBase: string | null;
  /** name, message, additional details, sender, recipient, description — the non-empty ones */
  texts: string[];
  description: string;
  /** the partner a rule or the owner put on the row's journal entry */
  journalPartnerId: string | null;
  journalBasCode: string | null;
  noDocumentNeeded: boolean;
  /** |amount| − Σ allocated from the row, 2 dp */
  remaining: string;
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

/** The Months panel (F69): one account × month square — every row proven, a row still to justify, or no import covers it. */
export type BankMonthCellState = "proven" | "open" | "not_imported";

export type BankMonthCell = {
  bankAccountId: string;
  /** `2026-07` */
  month: string;
  state: BankMonthCellState;
  rows: number;
  toJustify: number;
};

/** One bar: rows justified (linked / no document needed) and to justify (open / partially linked); derived, never stored. */
export type BankMonth = { month: string; justified: number; toJustify: number; built: boolean };

export type BankMonthsOverview = {
  from: string;
  to: string;
  /** oldest first */
  months: BankMonth[];
  accounts: { id: string; label: string; role: BankAccountRole; currency: string }[];
  cells: BankMonthCell[];
  /** the newest closed month with bank rows and no built package — *N transactions without proof — package YYYY-MM not built* */
  banner: { month: string; withoutProof: number } | null;
};

/**
 * One line of a bank row's History (the side panel, F71) — read from the audit trail, never stored. `by` is the
 * journal entry's `categorisedBy` after the change; `source` the caller's (web, system…).
 */
export type TransactionHistoryEvent = { at: string; source: string } & (
  | { kind: "imported" }
  | { kind: "categorised"; basCode: string; by: CategorisedBy | null }
  | {
      kind: "uncategorised" | "partner" | "no_document" | "document_needed";
      by: CategorisedBy | null;
    }
  | { kind: "linked"; linkKind: LinkKind; otherType: LinkableType }
);
