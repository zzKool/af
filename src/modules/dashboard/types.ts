// DTOs of the dashboard (feature inventory §3.14): what the page shows, computed on request from the modules'
// read models — nothing stored.
import type { YearWeeks } from "./year-weeks";

export const ACTION_KINDS = [
  "rows_to_justify",
  "documents_to_review",
  "unlinked_documents",
  "supplier_invoices_overdue",
  "supplier_invoices_due",
  "invoices_overdue",
  "owner_liability",
  "expenses_awaiting_row",
  "receipts_missing",
  "subscriptions_attention",
  "rate_gaps",
  "package_not_built",
  "package_flags",
  "vat_not_declared",
  "vat_not_paid",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type ActionPriority = "high" | "medium" | "low";

/** One thing to do, with the figure behind it and the page that resolves it. */
export type ActionItem = {
  id: string;
  kind: ActionKind;
  count: number;
  amount?: { value: string; currency: string };
  /** a month (`2026-06`) or a quarter (`CH 2026/Q2`) the item is about */
  period?: string;
  /** more figures the item's sentence names (F94: the subscription periods to confirm / charge / receipt missing) */
  params?: Record<string, number>;
  priority: ActionPriority;
  href: string;
};

export type PulseKind = "balance" | "receivables" | "payables" | "liability" | "invoicedYear";

/** One figure of the moment. */
export type PulseMetric = {
  id: string;
  kind: PulseKind;
  /** the account label for a balance; the kind otherwise (the dictionary names it) */
  label: string;
  value: string;
  currency: string;
  /** a date, a count, a year — what the figure is "as of" */
  hint: string | null;
  href: string;
};

export type BriefingLine = { entityType: string; action: string; count: number };

export type DashboardOverview = {
  items: ActionItem[];
  pulse: PulseMetric[];
  briefing: { since: string | null; lines: BriefingLine[] };
};

// --- Work: the monthly close (F137, spec US4 / FR-004 – FR-005) ---

/** The owner's monthly loop (2026-11-07), in his order, and the package that ends it. */
export const CLOSE_STEPS = ["rates", "statements", "justified", "expenses", "closed"] as const;
export type CloseStepKind = (typeof CLOSE_STEPS)[number];

/**
 * done · current (the first step not done — the one to do now) · todo (after it) · waiting (the package, until the
 * four steps before it are done). Derived, never stored.
 */
export type CloseStepState = "done" | "current" | "todo" | "waiting";

export type CloseStep = {
  kind: CloseStepKind;
  state: CloseStepState;
  /** how far: rates days stored / weekdays, accounts complete / monthly accounts, rows justified / rows… */
  done: number;
  total: number;
  href: string;
};

/** A monthly bank account and the last day its balance chain reaches (F115). */
export type CloseAccount = {
  label: string;
  currency: string;
  completeTo: string | null;
  complete: boolean;
};

/** A client invoiced for the month before and not yet for this one (FR-005). */
export type InvoiceReminder = { partnerId: string; partnerName: string; lastIssueDate: string };

export type MonthlyClose = {
  /** yyyy-mm */
  month: string;
  /** 0–100: the steps' progress, each a fifth */
  percent: number;
  steps: CloseStep[];
  /** the rates step's facts */
  rates: { weekdays: number; missing: number };
  accounts: CloseAccount[];
  /** the bank rows of the month (the Months panel's counts) */
  rows: { justified: number; toJustify: number };
  /** privately paid expenses dated in the month */
  privateExpenses: number;
  /** the Stockholm day the month's first package was built, null before */
  builtOn: string | null;
  /** the neighbours ‹ › — null past the first month with data / after this month */
  previous: string | null;
  next: string | null;
  reminders: InvoiceReminder[];
};

/** One of the past months: the day it was closed (its package built), or how far it is. */
export type PastClose = { month: string; builtOn: string | null; percent: number };

export type WorkData = {
  close: MonthlyClose;
  past: PastClose[];
  /** the months closed in a row, back from the newest closed one before this month */
  streak: number;
  /** the dashboard's items that are not steps of the close */
  alsoWaiting: ActionItem[];
};

// --- Home: the year at a glance (F138, spec US5 / FR-006 – FR-008) ---

/** A statement account's balance and its weight in the cash. */
export type CashAccount = {
  label: string;
  currency: string;
  /** the latest balance, in the account's currency; null before its first */
  balance: string | null;
  /** the same in the base at today's rate (the nearest-day rule); null without a balance or a rate */
  inBase: string | null;
  /** 0–100, its share of the total */
  share: number;
};

/** Cash · all statement accounts, in the tenant's base (D39). Decimal strings. */
export type CashSummary = {
  base: string;
  /** the total today, in base */
  total: string;
  /** today's total minus last month's last day's; null when that day had no balance at all */
  monthDelta: string | null;
  /** the total at the end of each of the last twelve months, then today; null before any balance */
  series: Array<{ day: string; total: string | null }>;
  accounts: CashAccount[];
  /** what a 1 % move of each foreign currency against the base is worth on what is held in it, largest first */
  exposure: Array<{ currency: string; onePercent: string }>;
  /** an account in a currency with no rate today: the total leaves it out (and says so) */
  incomplete: boolean;
};

/** One currency against the base over the last 90 days (the rates page's cross, FR-011 of rates). */
export type CurrencyTicker = {
  currency: string;
  /** 1 currency = now × base; null with no rate in the window */
  now: string | null;
  /** % change over the window, 1 dp; null with fewer than two points */
  change: number | null;
  /** the window's rates, oldest first */
  points: string[];
};

export type HomeData = {
  overview: DashboardOverview;
  cash: CashSummary;
  currencies: CurrencyTicker[];
  /** this year's bank rows, justified and to justify (the Months panel's counts) */
  year: { year: string; justified: number; toJustify: number };
  /** the owner's close — null for the accountant */
  work: WorkData | null;
  /** F158: the year, week by week — the statement accounts' money and justified squares */
  weeks: YearWeeks;
  /** F167: where the year's money went — income by client, costs by kind, what is kept */
  flow: MoneyFlow;
};

/** F167, the board's *Where 2026's money went*: the year so far, in the base. */
export type MoneyFlow = {
  year: string;
  income: { label: string; base: string }[];
  costs: { label: string; base: string }[];
  /** income − costs (negative: the year costs more than it brought) */
  kept: string;
};
