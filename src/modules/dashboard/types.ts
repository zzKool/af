// DTOs of the dashboard (feature inventory §3.14): what the page shows, computed on request from the modules'
// read models — nothing stored.

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
