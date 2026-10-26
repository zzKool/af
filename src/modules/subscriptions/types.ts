// Public DTOs of the subscriptions module (F94, D57). Plain types only — never Prisma types (constitution §2).
// A subscription holds expectations; a period is a read model computed from them and from what exists.

export type Becomes = "expense" | "supplier_invoice";
export const BECOMES: readonly Becomes[] = ["expense", "supplier_invoice"];
export type Cadence = "monthly" | "yearly";
export const CADENCES: readonly Cadence[] = ["monthly", "yearly"];

export type PriceDto = {
  id: string;
  validFrom: string;
  validTo: string | null;
  /** 2 dp — an expectation, never a money fact */
  amount: string;
  currency: string;
};

export type PauseDto = { id: string; fromDate: string; toDate: string; note: string };

export type SubscriptionDto = {
  id: string;
  name: string;
  partnerId: string;
  becomes: Becomes;
  basCode: string;
  groupId: string;
  paymentSourceId: string;
  vatRegistrationId: string | null;
  cadence: Cadence;
  startDate: string;
  endDate: string | null;
  matchText: string | null;
  /** percent, 2 dp (`"5.00"`) */
  tolerancePct: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** An ISO day range, both ends inclusive. */
export type DayWindow = { from: string; to: string };

/** One expected occurrence, before any fact is read. */
export type Period = {
  /** the expected date — also the period's identity within its subscription */
  date: string;
  /** the price valid on `date`, null when no price covers it */
  price: { amount: string; currency: string } | null;
  /** where a bank row may be booked (expected − 3 … + 7 days) */
  rowWindow: DayWindow;
  /** where a receipt / bill may be dated (± 10 days) */
  receiptWindow: DayWindow;
  /** the expected date falls in a pause */
  skipped: boolean;
};

export type PeriodState = "skipped" | "upcoming" | "due" | "charged" | "documented" | "done";
export const PERIOD_STATES: readonly PeriodState[] = [
  "skipped",
  "upcoming",
  "due",
  "charged",
  "documented",
  "done",
];

/** What a period needs or offers on top of its state. The first four are the to-dos (US6). */
export type PeriodMark =
  | "match_waiting"
  | "charge_missing"
  | "receipt_missing"
  | "bill_missing"
  | "overdue"
  | "two_charges";
export const ATTENTION_MARKS: readonly PeriodMark[] = [
  "match_waiting",
  "charge_missing",
  "receipt_missing",
  "bill_missing",
];

/** The entity a period is filled by, as the owning module derives it — never re-derived here. */
export type EntityFact = {
  type: Becomes;
  id: string;
  key: string;
  /** the expense date / the invoice date */
  date: string;
  amount: string;
  currency: string;
  hasDocument: boolean;
  /** it waits for a bank payment at all (a company-paid expense, any supplier invoice) */
  needsPayment: boolean;
  /** the owning module says it is paid */
  paid: boolean;
  /** the owning module says it is overdue (supplier invoices) */
  overdue: boolean;
  /** the owning module's own status word, shown as is */
  status: string;
};

/** A bank row offered to a period. */
export type RowMatch = {
  rowId: string;
  bookingDate: string;
  amount: string;
  currency: string;
  description: string;
  /** |charge − expected| / expected × 100, 2 dp; null when not comparable */
  diffPct: string | null;
  crossCurrency: boolean;
  /** found by the match text (else by the journal's partner) */
  byText: boolean;
  /** same currency, within the exact threshold, found by the text — eligible for *Confirm all exact* */
  exact: boolean;
  /** another period (of this or another subscription) is offered the same row */
  ambiguous: boolean;
  /** hints, never blocking: a rule says no document is needed; the journal's category differs */
  hints: ("rule_no_document" | "category_differs")[];
};

/** A receipt / bill offered to a period. */
export type DocumentMatch = {
  documentId: string;
  businessKey: string;
  date: string;
  total: string | null;
  currency: string | null;
  invoiceNumber: string | null;
  /** the VAT number equals the vendor's */
  certain: boolean;
  diffPct: string | null;
  /** the amount could not be compared (no currency read, or no rate) */
  amountUnknown: boolean;
  ambiguous: boolean;
};

/** A period with its facts read: the state, the marks, the entity, the offers. */
export type PeriodView = Period & {
  state: PeriodState;
  marks: PeriodMark[];
  entities: EntityFact[];
  rows: RowMatch[];
  documents: DocumentMatch[];
};

export type SubscriptionListRow = {
  id: string;
  name: string;
  partnerId: string;
  partnerName: string | null;
  becomes: Becomes;
  cadence: Cadence;
  basCode: string;
  groupId: string;
  groupLabel: string;
  paymentSourceLabel: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  /** the next period on or after today */
  nextDate: string | null;
  expectedAmount: string | null;
  expectedCurrency: string | null;
  /** the state of the latest period that is not upcoming */
  currentState: PeriodState | null;
  /** periods with a to-do mark */
  attention: number;
};

export type SubscriptionDetail = {
  subscription: SubscriptionDto;
  partnerName: string | null;
  groupLabel: string;
  paymentSourceLabel: string;
  prices: PriceDto[];
  pauses: PauseDto[];
  /** newest first; the next upcoming one on top */
  periods: PeriodView[];
};

export type AttentionCounts = {
  /** periods with at least one to-do mark */
  periods: number;
  toConfirm: number;
  chargeMissing: number;
  /** receipts and bills together */
  documentMissing: number;
};
