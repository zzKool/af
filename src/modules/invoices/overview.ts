// The invoices page's hero (F163, Pulse everywhere): what the company invoiced this year in the base against the same
// span last year, what is still open and what is late (the oldest named), the drafts waiting, twelve months of
// invoicing, and who it came from. Derived on request from the list's own rows (`listInvoices`, every derived state
// already computed) — nothing stored. `invoicesOverviewFrom` is pure; `invoicesOverview` reads.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { lastMonths } from "./partner-insight";
import { listInvoices } from "./queries";
import { signedTotal } from "./signed";
import type { InvoiceListRow } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export type InvoiceOverviewRow = Pick<
  InvoiceListRow,
  | "id"
  | "type"
  | "status"
  | "state"
  | "number"
  | "partnerName"
  | "issueDate"
  | "dueDate"
  | "currency"
  | "totalAmount"
  | "totalBase"
  | "remaining"
>;

export type InvoicesOverview = {
  year: string;
  /** Σ base of the year's invoices − credit notes (issued, not drafts) */
  invoicedYear: string;
  /** the same span last year (January to today's month and day); null when nothing was invoiced then */
  invoicedLastYear: string | null;
  open: { count: number; base: string };
  overdue: { count: number; base: string; oldest: { number: string; days: number } | null };
  drafts: { count: number; base: string };
  paidYear: number;
  /** the last twelve months, oldest first: Σ base invoiced, and whether something of the month is still open */
  months: { month: string; base: string; open: boolean }[];
  /** the year's invoicing per client, largest first (the rest folded into `others`) */
  clients: { name: string; base: string }[];
  others: string;
};

const IS_INCOME = (r: InvoiceOverviewRow) => r.type === "invoice" || r.type === "credit_note";
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** the open part of a document in the base: remaining × base ÷ total (the document's own rate) */
function openBase(r: InvoiceOverviewRow): Dec {
  const total = new D(r.totalAmount);
  if (total.isZero() || r.totalBase === null) return new D(0);
  return new D(r.remaining).mul(r.totalBase).div(total);
}

export function invoicesOverviewFrom(
  rows: readonly InvoiceOverviewRow[],
  today: string,
  topClients = 5,
): InvoicesOverview {
  const year = today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const sameDayLastYear = `${lastYear}${today.slice(4)}`;
  const issued = rows.filter((r) => IS_INCOME(r) && r.status !== "draft");
  const base = (r: InvoiceOverviewRow) => signedTotal(r.type, r.totalBase ?? "0");
  const sum = (list: readonly InvoiceOverviewRow[], f: (r: InvoiceOverviewRow) => Dec) =>
    list.reduce((s, r) => s.plus(f(r)), new D(0));

  const thisYear = issued.filter((r) => r.issueDate.startsWith(year) && r.issueDate <= today);
  const lastSpan = issued.filter(
    (r) => r.issueDate.startsWith(lastYear) && r.issueDate <= sameDayLastYear,
  );
  const open = issued.filter((r) => r.type === "invoice" && new D(r.remaining).gt(0));
  const overdue = open.filter((r) => r.state === "overdue");
  const oldest = [...overdue].sort((a, b) =>
    (a.dueDate ?? a.issueDate).localeCompare(b.dueDate ?? b.issueDate),
  )[0];
  const drafts = rows.filter((r) => IS_INCOME(r) && r.status === "draft");

  const months = lastMonths(today).map((month) => {
    const inMonth = issued.filter((r) => r.issueDate.startsWith(month));
    return {
      month,
      base: sum(inMonth, base).toFixed(2),
      open: inMonth.some((r) => r.type === "invoice" && new D(r.remaining).gt(0)),
    };
  });

  const byClient = new Map<string, Dec>();
  for (const r of thisYear)
    byClient.set(r.partnerName, (byClient.get(r.partnerName) ?? new D(0)).plus(base(r)));
  const ranked = [...byClient.entries()].sort((a, b) => b[1].comparedTo(a[1]));

  return {
    year,
    invoicedYear: sum(thisYear, base).toFixed(2),
    invoicedLastYear: lastSpan.length > 0 ? sum(lastSpan, base).toFixed(2) : null,
    open: { count: open.length, base: sum(open, openBase).toFixed(2) },
    overdue: {
      count: overdue.length,
      base: sum(overdue, openBase).toFixed(2),
      oldest: oldest
        ? {
            number: oldest.number ?? "",
            days: daysBetween(oldest.dueDate ?? oldest.issueDate, today),
          }
        : null,
    },
    drafts: { count: drafts.length, base: sum(drafts, (r) => base(r)).toFixed(2) },
    paidYear: thisYear.filter((r) => r.type === "invoice" && r.state === "paid").length,
    months,
    clients: ranked.slice(0, topClients).map(([name, v]) => ({ name, base: v.toFixed(2) })),
    others: ranked
      .slice(topClients)
      .reduce((s, [, v]) => s.plus(v), new D(0))
      .toFixed(2),
  };
}

export async function invoicesOverview(
  tx: TransactionClient,
  today: string,
): Promise<InvoicesOverview> {
  const list = await listInvoices(
    tx,
    { page: 1, pageSize: 5000, sort: [{ col: "issueDate", dir: "desc" }], filters: {} },
    today,
  );
  return invoicesOverviewFrom(list.rows, today);
}
