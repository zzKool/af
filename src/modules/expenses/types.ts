// DTOs of the expenses module (specs/expenses/spec.md). Prisma types never leave the module; Decimals are strings.

export const EXPENSE_GROUP_KINDS = ["trip", "batch"] as const;
export type ExpenseGroupKind = (typeof EXPENSE_GROUP_KINDS)[number];

export const PAYMENT_SOURCE_KINDS = ["bank_account", "private"] as const;
export type PaymentSourceKind = (typeof PAYMENT_SOURCE_KINDS)[number];

export const EXPENSE_KINDS = ["receipt", "per_diem", "vat_payment"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const EXPENSE_RATE_SOURCES = [
  "same_currency",
  "ecb_daily",
  "ecb_nearest",
  "bank",
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

export type PaymentSourceDto = {
  id: string;
  tenantId: string;
  label: string;
  kind: PaymentSourceKind;
  bankAccountId: string | null;
  currency: string;
  isActive: boolean;
  ownerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  baseProvisional: boolean;
  paidAmount: string | null;
  paidCurrency: string | null;
  paymentSourceId: string;
  documentMissing: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

export type SettlementLineDto = {
  id: string;
  settlementId: string;
  expenseId: string;
  allocatedBase: string;
  note: string | null;
};

export type SettlementDto = {
  id: string;
  tenantId: string;
  number: string;
  bankTransactionId: string;
  paymentSourceId: string;
  refundAmount: string;
  refundCurrency: string;
  refundBase: string;
  allocatedBase: string;
  exchangeDifferenceBase: string;
  roundingBase: string;
  exchangeDifferenceBasCode: string | null;
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

/** What the FIFO proposal (or the owner's adjustment) allocates to one expense. */
export type SettlementAllocation = {
  expenseId: string;
  key: string;
  date: string;
  description: string;
  amountBase: string;
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
  paymentSourceId: string | null;
  lines: SettlementAllocation[];
  allocatedBase: string;
  /** Σ lines − refund base when outside the tolerance (needs confirmation); "0.00" otherwise */
  exchangeDifferenceBase: string;
  /** Σ lines − refund base when within the 0.50 SEK tolerance */
  roundingBase: string;
  /** what the ticked expenses still leave open after this settlement */
  residualOpen: string;
  /** refund base not covered by the lines (when the lines do not reach the refund) */
  unallocatedOnTransaction: string;
};

export type LedgerSource = {
  paymentSourceId: string;
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
  kind: ExpenseKind;
  basCode: string;
  basLabel: string;
  alias: string;
  amount: string;
  currency: string;
  amountBase: string;
  baseProvisional: boolean;
  rateSource: ExpenseRateSource;
  paidAmount: string | null;
  paidCurrency: string | null;
  paymentSourceId: string;
  paymentSourceLabel: string;
  paymentSourceKind: PaymentSourceKind;
  status: ExpenseStatus;
  allocatedBase: string;
  openBase: string;
  documentMissing: boolean;
  hasDocument: boolean;
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
export type SourceOption = {
  id: string;
  label: string;
  kind: "bank_account" | "private";
  bankAccountId: string | null;
  currency: string;
  isActive: boolean;
};
export type CategoryOption = { code: string; label: string };
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
