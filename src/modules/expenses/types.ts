// DTOs of the expenses module (specs/expenses/spec.md). Prisma types never leave the module; Decimals are strings.

export const EXPENSE_GROUP_KINDS = ["trip", "batch"] as const;
export type ExpenseGroupKind = (typeof EXPENSE_GROUP_KINDS)[number];

/** who paid (F114): a main bank account of the company, or a private instrument of the owner (`bank_accounts.role = owner_private`) */
export const PAYER_KINDS = ["bank_account", "private"] as const;
export type PayerKind = (typeof PAYER_KINDS)[number];

export const EXPENSE_KINDS = ["receipt", "per_diem", "vat_payment"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

/** the base is written once at the receipt's date — never the bank's (F114, CHECK `rate_source <> 'bank'`) */
export const EXPENSE_RATE_SOURCES = [
  "same_currency",
  "ecb_daily",
  "ecb_nearest",
  "manual",
] as const;
export type ExpenseRateSource = (typeof EXPENSE_RATE_SOURCES)[number];

/** Derived, never stored (FR-005). */
export const EXPENSE_STATUSES = [
  "paid",
  "awaiting_link",
  "to_refund",
  "partially_refunded",
  "refunded",
] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const SETTLEMENT_STATUSES = ["active", "cancelled"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export type ExpenseGroupDto = {
  id: string;
  tenantId: string;
  number: number;
  description: string;
  kind: ExpenseGroupKind;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

export type ExpenseDto = {
  id: string;
  tenantId: string;
  groupId: string;
  key: string;
  seq: number;
  alias: string;
  kind: ExpenseKind;
  date: string;
  description: string;
  basCode: string;
  amount: string;
  currency: string;
  vatAmount: string | null;
  vatRegistrationId: string | null;
  amountBase: string;
  rate: string;
  rateSource: ExpenseRateSource;
  rateDate: string | null;
  /** the payer: a bank account (main = the company, owner_private = the owner) */
  paidFromAccountId: string;
  documentMissing: boolean;
  /** the merchant as a partner (F87) — a vendor, validated through partners; never on a per-diem */
  partnerId: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

/** One `settles` link of a settlement, as the statement and the panel list it (F114: derived from the links). */
export type SettlementLineDto = {
  linkId: string;
  expenseId: string;
  key: string;
  date: string;
  description: string;
  /** what the link refunds of the expense, in its currency */
  allocatedAmount: string;
  currency: string;
  /** what the refund row gave for it, in base */
  allocatedBase: string;
  /** the expense's base for the refunded share — what the books carried */
  expectedBase: string;
  note: string | null;
};

/**
 * A settlement: the numbered statement over the `settles` links of one refund row (F114, D60). The refund's
 * amount and base are the row's; Σ base, the rounding and the FX difference are derived from the links — signed:
 * > 0 the company paid the owner more base than the claim (7960, a loss), < 0 less (3960, a gain).
 */
export type SettlementDto = {
  id: string;
  tenantId: string;
  number: string;
  bankTransactionId: string;
  refundAmount: string;
  refundCurrency: string;
  refundBase: string;
  bookingDate: string;
  allocatedBase: string;
  /** Σ expected bases of the lines — the claim the links settle, in base */
  expectedBase: string;
  /** `allocatedBase − expectedBase`, signed */
  differenceBase: string;
  /** the difference is within the tolerance — rounding, not a gain or a loss */
  rounding: boolean;
  /** 3960 / 7960 by the sign of the difference; null when there is none or it is rounding */
  differenceBasCode: string | null;
  /** refund base the lines do not cover — what stays open on the row */
  unallocatedBase: string;
  note: string | null;
  status: SettlementStatus;
  cancelledAt: Date | null;
  statementDocumentId: string | null;
  statementSuperseded: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
  lines: SettlementLineDto[];
};

/** What the FIFO proposal (or the owner's adjustment) allocates to one expense — in base, the claim's currency. */
export type SettlementAllocation = {
  expenseId: string;
  key: string;
  date: string;
  description: string;
  amount: string;
  currency: string;
  amountBase: string;
  /** the owner's claim still open, in base */
  openBase: string;
  allocatedBase: string;
  remainingOpen: string;
};

export type SettlementProposal = {
  bankTransactionId: string;
  bookingDate: string;
  refundAmount: string;
  refundCurrency: string;
  refundBase: string;
  paidFromAccountId: string | null;
  lines: SettlementAllocation[];
  allocatedBase: string;
  /** Σ lines − refund base, signed — the FX difference the statement will show; "0.00" when within the tolerance */
  differenceBase: string;
  /** the same difference when it is within the tolerance — rounding */
  roundingBase: string;
  /** what the ticked expenses still leave open after this settlement */
  residualOpen: string;
  /** refund base not covered by the lines (when the lines do not reach the refund) */
  unallocatedOnTransaction: string;
};

export type LedgerSource = {
  paidFromAccountId: string;
  label: string;
  currency: string;
  openBase: string;
  allocatedBase: string;
  openCount: number;
};

export type LedgerSnapshot = {
  total: { openBase: string; allocatedBase: string; openCount: number };
  sources: LedgerSource[];
  /** company-paid expenses still without their bank row */
  awaitingLinkCount: number;
};

/** One row of the expenses list (FR-011). */
export type ExpenseListRow = {
  id: string;
  key: string;
  groupId: string;
  groupNumber: number;
  groupDescription: string;
  date: string;
  description: string;
  /** the partner (F87): stored id, name joined over the set; null without one */
  partnerId: string | null;
  partnerName: string | null;
  kind: ExpenseKind;
  basCode: string;
  basLabel: string;
  alias: string;
  amount: string;
  currency: string;
  amountBase: string;
  rateSource: ExpenseRateSource;
  paidFromAccountId: string;
  payerLabel: string;
  payerKind: PayerKind;
  status: ExpenseStatus;
  /** Σ allocating links onto it, the expense's currency, and what is still open */
  allocated: string;
  open: string;
  /** Σ base the rows gave; the owner's claim still open in base (private) */
  allocatedBase: string;
  openBase: string;
  /** Σ base − the expense's base for the paid share, signed (F114); "0.00" while nothing is paid */
  fxDifference: string;
  documentMissing: boolean;
  hasDocument: boolean;
  /** made from a document that says the buyer pays the VAT (D54, F91) */
  reverseCharge: boolean;
  note: string | null;
  vatAmount: string | null;
  createdAt: Date;
};

// --- option shapes the dialogs and panels share (plain data) ---

export type GroupOption = {
  id: string;
  number: number;
  description: string;
  kind: "trip" | "batch";
};
/** A payer the pickers offer (F114): a bank account — `kind` says whether a bank row pays it or a settlement refunds it. */
export type SourceOption = {
  id: string;
  label: string;
  kind: PayerKind;
  currency: string;
};
export type CategoryOption = { code: string; label: string };
/** A vendor the expense's partner picker offers (F87): active vendors only. */
export type VendorOption = { id: string; name: string; defaultBasCategoryCode: string | null };
export type DocumentOption = { id: string; businessKey: string; fileName: string; status: string };
export type TransactionOption = {
  id: string;
  bookingDate: string;
  amount: string;
  currency: string;
  description: string;
  bankAccountId: string;
  accountLabel: string;
  amountBase: string | null;
};

// --- the entity duplicate check (specs/documents US3, D32) — shared shape with supplier invoices ---
export type DuplicateConfidence = "high" | "medium";
export type DuplicateMatch = {
  kind: "exact" | "hash" | "fuzzy";
  confidence: DuplicateConfidence;
  entityType: "expense" | "supplier_invoice";
  entityId: string;
  entityKey: string;
  partnerName: string | null;
  /** a dictionary key + its parameters; the dialog renders it in the user's language */
  reason: { key: string; params: Record<string, string | number> };
};
export type DuplicateAck = { entityIds: string[]; note: string };
