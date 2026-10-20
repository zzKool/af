// DTOs of the package module (specs/accountant-package/spec.md). Plain types, never Prisma; money as decimal
// strings with two decimals, dates ISO. `PeriodData` is what the collector returns and what the pure generators
// (CSV, summary.xlsx, notes.md, zip) take — serialisable, so the generators are tested without a database.

export const PACKAGE_BUILD_STATUSES = ["queued", "building", "built", "failed"] as const;
export type PackageBuildStatus = (typeof PACKAGE_BUILD_STATUSES)[number];

export type PackageCounts = {
  bankRows: number;
  invoices: number;
  supplierInvoices: number;
  expenses: number;
  settlements: number;
  documents: number;
};

export type PackageBuildDto = {
  id: string;
  tenantId: string;
  /** `2026-06` or `2026` */
  period: string;
  version: number;
  status: PackageBuildStatus;
  documentId: string | null;
  businessKey: string;
  counts: PackageCounts;
  flags: number;
  notes: string | null;
  error: string | null;
  builtAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

/** A period as the collector sees it: a month, or the year (twelve months + the savings export, D31). */
export type PackagePeriod = {
  kind: "month" | "year";
  /** `2026-06` / `2026` */
  period: string;
  /** inclusive ISO bounds */
  from: string;
  to: string;
};

export const FLAG_KINDS = [
  "missing_document",
  "document_not_ready",
  "unlinked_row",
  "delta",
  "unpaid_invoice",
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/** One thing the accountant would ask about (R7) — a line of notes.md and a row of the Flags sheet. */
export type PackageFlag = {
  kind: FlagKind;
  entity: "bank_transaction" | "invoice" | "supplier_invoice" | "expense" | "settlement";
  key: string;
  detail: string;
};

export type BankSheetRow = {
  id: string;
  account: string;
  accountRole: "main" | "savings";
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
  counterpartyKey: string;
  basCode: string | null;
  basLabel: string | null;
  rate: string | null;
  rateSource: string | null;
  amountBase: string | null;
  /** business keys of what the row justifies, `transfer ↔ …`, `settles ST26-001` */
  related: string[];
  allocated: string;
  /** |amount| − allocated, in the row's currency; "0.00" when linked or no document needed */
  delta: string;
  status: "linked" | "partial" | "open" | "no_document";
  note: string | null;
  flags: string[];
  importFileName: string;
  rowIndex: number;
  /** the account's CSV conventions */
  delimiter: string;
  decimalSeparator: string;
};

export type IncomeRow = {
  id: string;
  number: string;
  type: "invoice" | "credit_note";
  client: string;
  issueDate: string;
  dueDate: string | null;
  periodLabel: string | null;
  currency: string;
  net: string;
  vatRates: string;
  vat: string;
  total: string;
  totalBase: string | null;
  paid: string;
  remaining: string;
  status: string;
  declarationPeriod: string | null;
  /** the PDF's business key, null while the job has not rendered it */
  pdfKey: string | null;
  /** why it is in this period (D31: issued and paid months both) */
  reason: string;
  flags: string[];
};

export type SupplierRow = {
  id: string;
  key: string;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  net: string;
  vat: string;
  total: string;
  amountBase: string;
  rateSource: string;
  basCode: string;
  basLabel: string;
  paid: string;
  open: string;
  status: string;
  /** the bank rows that paid it: `SEK 2026-06-12 −1 250.00` */
  paidVia: string[];
  documentKey: string | "MISSING";
  reason: string;
  note: string | null;
  flags: string[];
};

export type ExpenseRow = {
  id: string;
  group: string;
  key: string;
  description: string;
  date: string;
  basCode: string;
  basLabel: string;
  alias: string;
  amount: string;
  currency: string;
  rateSource: string;
  amountBase: string;
  paidBy: string;
  status: string;
  /** the refund's booking date (the settlement's bank row) when refunded */
  refundDate: string | null;
  /** the settlement number when refunded */
  settlement: string | null;
  documentKey: string | "MISSING";
  reason: string;
  note: string | null;
  flags: string[];
};

export type SettlementRow = {
  id: string;
  number: string;
  bookingDate: string | null;
  paidBy: string;
  refundAmount: string;
  currency: string;
  refundBase: string;
  allocatedBase: string;
  exchangeDifferenceBase: string;
  roundingBase: string;
  /** expense keys settled */
  expenses: string[];
  statementKey: string | null;
  flags: string[];
};

export type LinkRow = {
  id: string;
  fromType: string;
  fromKey: string;
  toType: string;
  toKey: string;
  kind: string;
  allocated: string | null;
  currency: string | null;
  createdAt: string;
};

export type TransferNote = {
  date: string;
  from: string;
  to: string;
  /** the rate implied by the two amounts (to / from), six decimals */
  implied: string;
};

export type LiabilityNote = {
  source: string;
  currency: string;
  openBase: string;
  openCount: number;
};

export type VatPeriodNote = {
  declarationPeriod: string;
  currency: string;
  count: number;
  net: string;
  vat: string;
  total: string;
};

export type PackageFolder = "client-invoices" | "supplier-invoices" | "expenses" | "documents";

/** A stored document to copy into the zip — the bytes are fetched by the job, outside the collecting transaction. */
export type PackageDocument = {
  id: string;
  folder: PackageFolder;
  /** `<business key><ext>` */
  fileName: string;
  businessKey: string;
  mimeType: string;
  fileSize: number;
};

export type PeriodData = {
  period: PackagePeriod;
  bank: BankSheetRow[];
  income: IncomeRow[];
  suppliers: SupplierRow[];
  expenses: ExpenseRow[];
  settlements: SettlementRow[];
  links: LinkRow[];
  flags: PackageFlag[];
  transfers: TransferNote[];
  liability: LiabilityNote[];
  vatPeriods: VatPeriodNote[];
  documents: PackageDocument[];
  /** when the data was collected (the notes say so); never part of a file's bytes other than notes.md */
  collectedAt: string;
};

/** One row of the `/package` page: a month (or a year) with its live counts, flags and builds. */
export type PeriodOverview = {
  period: string;
  kind: "month" | "year";
  counts: PackageCounts;
  flags: number;
  builds: PackageBuildDto[];
};
