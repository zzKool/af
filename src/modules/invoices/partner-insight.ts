// The partner page's invoicing (F144, Pulse phase 7b; the board *Partner*): what was invoiced this year against the
// same months last year, what is not invoiced yet (drafts, issued but not sent, unpaid), how many days the client
// takes to pay, the days billed, twelve months of invoiced-and-paid, and what happened lately. Derived on request
// from the client's documents and the bank rows that pay them — nothing stored. `partnerInsightFrom` is pure;
// `partnerInsight` reads.
import { Prisma } from "@/generated/prisma/browser";
import { stockholmDay } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { clientPaymentHistory } from "./payment-history";
import { type PaidInvoice, type PaymentStats, paymentStats } from "./payment-stats";
import { listInvoices } from "./queries";
import { signedTotal } from "./signed";
import type { InvoiceListRow } from "./types";

type Dec = InstanceType<typeof Prisma.Decimal>;

export type InsightRow = Pick<
  InvoiceListRow,
  | "id"
  | "type"
  | "status"
  | "number"
  | "issueDate"
  | "periodLabel"
  | "currency"
  | "totalAmount"
  | "remaining"
> & { sentAt: string | null };

export type InsightMonth = {
  /** `2026-07` */
  month: string;
  /** Σ invoiced in the main currency that month (credit notes take back) */
  invoiced: string;
  /** the average days to pay of the month's paid invoices; null when none was paid */
  paidDays: number | null;
  /** something invoiced that month is still open */
  open: boolean;
};

export type InsightEvent = {
  /** the invoice's id — the line links to it */
  id: string;
  date: string;
  kind: "draft" | "issued" | "sent" | "paid";
  number: string | null;
  periodLabel: string | null;
  amount: string;
  currency: string;
  /** paid: days after the issue */
  days?: number;
};

export type PartnerInsight = {
  year: string;
  /** the currency the client is invoiced in (the most used this year, else ever); null without an invoice */
  currency: string | null;
  invoicedYear: string;
  /** the same months last year (January to today's month and day) */
  invoicedLastYear: string;
  drafts: { count: number; total: string; newest: { periodLabel: string | null } | null };
  notSent: number;
  unpaid: { count: number; total: string };
  stats: PaymentStats | null;
  lateThisYear: number;
  daysBilledYear: string;
  months: InsightMonth[];
  events: InsightEvent[];
  invoiceCount: number;
};

const EVENTS = 8;
const MONTHS = 12;

function mode(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

/** The last `MONTHS` months up to `today`'s, oldest first (`2025-08` … `2026-07`). */
export function lastMonths(today: string, n = MONTHS): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export function partnerInsightFrom(
  rows: readonly InsightRow[],
  history: readonly PaidInvoice[],
  daysBilledYear: string,
  today: string,
): PartnerInsight {
  const year = today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const income = rows.filter((r) => r.status !== "draft" && r.type !== "quote");
  const currency =
    mode(income.filter((r) => r.issueDate.startsWith(year)).map((r) => r.currency)) ??
    mode(income.map((r) => r.currency)) ??
    mode(rows.map((r) => r.currency));
  const inCur = income.filter((r) => r.currency === currency);
  const sum = (list: readonly InsightRow[]): Dec =>
    list.reduce((s, r) => s.add(signedTotal(r.type, r.totalAmount)), new Prisma.Decimal(0));
  const sameDayLastYear = `${lastYear}${today.slice(4)}`;

  const drafts = rows
    .filter((r) => r.status === "draft" && r.type === "invoice")
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const unpaid = inCur.filter((r) => r.type === "invoice" && new Prisma.Decimal(r.remaining).gt(0));

  const byId = new Map(history.map((h) => [h.id, h]));
  const months = lastMonths(today).map((month): InsightMonth => {
    const of = inCur.filter((r) => r.issueDate.startsWith(month));
    const paid = of.map((r) => byId.get(r.id)).filter((h): h is PaidInvoice => !!h);
    return {
      month,
      invoiced: sum(of).toFixed(2),
      paidDays: paid.length ? Math.round(paid.reduce((s, h) => s + h.days, 0) / paid.length) : null,
      open: of.some((r) => r.type === "invoice" && new Prisma.Decimal(r.remaining).gt(0)),
    };
  });

  const events: InsightEvent[] = [];
  for (const r of rows) {
    if (r.type === "quote") continue;
    const base = {
      id: r.id,
      number: r.number,
      periodLabel: r.periodLabel,
      amount: r.totalAmount,
      currency: r.currency,
    };
    if (r.status === "draft") {
      if (r.type === "invoice") events.push({ ...base, kind: "draft", date: r.issueDate });
      continue;
    }
    events.push({ ...base, kind: "issued", date: r.issueDate });
    if (r.sentAt) events.push({ ...base, kind: "sent", date: r.sentAt });
    const h = byId.get(r.id);
    if (h) events.push({ ...base, kind: "paid", date: h.paidOn, days: h.days });
  }
  const order = { paid: 3, sent: 2, issued: 1, draft: 0 } as const;
  events.sort((a, b) => b.date.localeCompare(a.date) || order[b.kind] - order[a.kind]);

  return {
    year,
    currency,
    invoicedYear: sum(inCur.filter((r) => r.issueDate.startsWith(year))).toFixed(2),
    invoicedLastYear: sum(
      inCur.filter((r) => r.issueDate.startsWith(lastYear) && r.issueDate <= sameDayLastYear),
    ).toFixed(2),
    drafts: {
      count: drafts.length,
      total: drafts.reduce((s, r) => s.add(r.totalAmount), new Prisma.Decimal(0)).toFixed(2),
      newest: drafts[0] ? { periodLabel: drafts[0].periodLabel } : null,
    },
    notSent: income.filter((r) => r.type === "invoice" && r.status === "issued").length,
    unpaid: {
      count: unpaid.length,
      total: unpaid.reduce((s, r) => s.add(r.remaining), new Prisma.Decimal(0)).toFixed(2),
    },
    stats: paymentStats(history),
    lateThisYear: history.filter((h) => h.late && h.paidOn.startsWith(year)).length,
    daysBilledYear,
    months,
    events: events.slice(0, EVENTS),
    invoiceCount: rows.filter((r) => r.type !== "quote").length,
  };
}

/** The partner's invoicing as the page shows it. */
export async function partnerInsight(
  tx: TransactionClient,
  partnerId: string,
  today: string,
): Promise<PartnerInsight> {
  const list = await listInvoices(
    tx,
    {
      page: 1,
      pageSize: 1000,
      sort: [{ col: "issueDate", dir: "desc" }],
      filters: { partnerId: { kind: "in", values: [partnerId] } },
    },
    today,
  );
  const rows: InsightRow[] = list.rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    number: r.number,
    issueDate: r.issueDate,
    periodLabel: r.periodLabel,
    currency: r.currency,
    totalAmount: r.totalAmount,
    remaining: r.remaining,
    sentAt: r.sentAt ? stockholmDay(r.sentAt) : null,
  }));
  const history = await clientPaymentHistory(tx, partnerId, today, 1000);
  const year = today.slice(0, 4);
  const days = await tx.invoiceLine.aggregate({
    _sum: { quantity: true },
    where: {
      unit: "day",
      invoice: {
        partnerId,
        type: "invoice",
        status: { not: "draft" },
        issueDate: { gte: new Date(`${year}-01-01`), lte: new Date(today) },
      },
    },
  });
  return partnerInsightFrom(
    rows,
    history,
    (days._sum.quantity ?? new Prisma.Decimal(0)).toFixed(1),
    today,
  );
}
