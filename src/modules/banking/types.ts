// Public DTOs of the banking module. Plain types only — never Prisma types (constitution §2).
// Decimals travel as strings ("-20000.00"), dates as ISO strings ("2026-07-08").

import type { LinkableType, LinkKind } from "@/modules/linking";
import type { BaseRateResult } from "@/modules/rates";
import type { BalanceGap } from "./completeness";
import type { BankFormatConfig } from "./csv-parser";

/** A row's base rate source: the words of rates' `rateToBase` (`same_currency` · `ecb_daily` · `ecb_nearest`) or a
 * rate typed by hand (`manual`, no row carries it since F113 — the vocabulary stays one with expenses). */
export type RateSource = BaseRateResult["source"] | "manual";
// a Record so the compiler refuses a list that misses a member of RateSource
const RATE_SOURCE_SET: Record<RateSource, true> = {
  same_currency: true,
  ecb_daily: true,
  ecb_nearest: true,
  manual: true,
};
export const RATE_SOURCES = Object.keys(RATE_SOURCE_SET) as readonly RateSource[];

/** Who set the category / partner last: the owner by hand or a rule (null = uncategorised). `partner_default` is
 * gone from the database (F67) — it stays in this read type for the audit rows written before. */
export type CategorisedBy = "manual" | "rule" | "partner_default";

/** The owner's facts on a row (`categorise`). */
export type CategoriseInput = {
  basCode?: string | null;
  partnerId?: string | null;
  note?: string | null;
  noDocumentNeeded?: boolean;
};

/** main / savings import statements; owner_private is a private instrument of the owner (F114, D60): no format, no rows */
export type BankAccountRole = "main" | "savings" | "owner_private";
export const BANK_ACCOUNT_ROLES: readonly BankAccountRole[] = ["main", "savings", "owner_private"];
/** the roles that import statements — every read of "the accounts" that means statements filters on these */
export const STATEMENT_ROLES: readonly BankAccountRole[] = ["main", "savings"];
/** what kind of payer an account is (F114): the company's (a bank row pays), the owner's (a settlement refunds), or none (savings) */
export type PayerKind = "bank_account" | "private";
const PAYER_KIND: Readonly<Record<BankAccountRole, PayerKind | null>> = {
  main: "bank_account",
  savings: null,
  owner_private: "private",
};
export function payerKindOf(role: BankAccountRole | string): PayerKind | null {
  return PAYER_KIND[role as BankAccountRole] ?? null;
}

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
  /** null for an owner_private account — nothing to import */
  bankFormatId: string | null;
  role: BankAccountRole;
  iban: string | null;
  bic: string | null;
  /** CSV imports into this account — number and currency are locked when > 0 (F65) */
  imports: number;
  bankFormat: BankFormatDto | null;
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
  // the SEK base, written once by the import (F113, D59): signed like `amount`
  amountBase: string;
  rate: string;
  rateSource: RateSource;
  rateDate: string | null;
  // the owner's facts — category, partner, note, no document needed — set by hand or a rule, never by the bank
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
  /** the account's currency — the gaps are stated in it */
  currency: string;
  /** ids of the transactions created by this import (the workbench highlights them) */
  transactionIds: string[];
  /** rules applied on the new rows */
  categorised: number;
  /** the account's balance chain after this import (F115): how far it proves the account, the gaps it found */
  completeTo: string | null;
  balanceGaps: BalanceGap[];
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

/** Derived from links and the row's *no document needed* flag — never stored. */
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

/** The workbench row: the transaction with its facts, the labels, the derived state. */
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
  // the base and the owner's facts (on the row, F113)
  amountBase: string;
  rate: string;
  rateSource: RateSource;
  /** the transfer pair's implied rate, derived from the `transfer` link (D44) */
  bankImplicitRate: string | null;
  basCode: string | null;
  basLabel: string | null;
  partnerId: string | null;
  partnerName: string | null;
  /** F98: the current category proposal (derived): code, source word, confidence 0–1 */
  proposedBasCode: string | null;
  proposedSource: "rule" | "partner_default" | "memory" | "model" | null;
  proposedConfidence: number | null;
  note: string | null;
  noDocumentNeeded: boolean;
  categorisedBy: CategorisedBy | null;
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
  /** the row's base (F113) */
  amountBase: string;
};

/** An outgoing row inside a date window with what a matcher reads (`outgoingRowsInWindow`, F94). Amounts absolute. */
export type WindowRow = {
  id: string;
  bankAccountId: string;
  bookingDate: string;
  /** |amount|, 2 dp */
  amount: string;
  currency: string;
  /** |the row's base| */
  amountBase: string;
  /** name, message, additional details, sender, recipient, description — the non-empty ones */
  texts: string[];
  description: string;
  /** the partner and category a rule or the owner put on the row */
  partnerId: string | null;
  basCode: string | null;
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
/** proven = justified and the balance chain covers the month whole (F115); incomplete = justified, chain not there */
export type BankMonthCellState = "proven" | "open" | "incomplete" | "not_imported";

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
  accounts: {
    id: string;
    label: string;
    role: BankAccountRole;
    currency: string;
    /** the last day the balance chain reaches without a gap (F115), null without a balanced row */
    completeTo: string | null;
    /** how many gaps the chain found — rows missing between exports */
    gaps: number;
  }[];
  cells: BankMonthCell[];
  /** the newest closed month with bank rows and no built package — *N transactions without proof — package YYYY-MM not built* */
  banner: { month: string; withoutProof: number } | null;
};

/**
 * One line of a bank row's History (the side panel, F71) — read from the audit trail, never stored. `by` is the
 * row's `categorisedBy` after the change; `source` the caller's (web, system…).
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
