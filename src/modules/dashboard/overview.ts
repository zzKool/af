// The dashboard's read model (feature inventory §3.14; specs/dashboard/spec.md): the action items — what the owner
// has to do, each with the count behind it and the page that resolves it — the business pulse (the figures of the
// moment) and the briefing since the last visit, read from the audit trail. Everything comes from the modules'
// read models; nothing here is stored. Owner and accountant see the same page; the accountant's items are the
// read-only ones (the package, the declarations).
import { Prisma } from "@/generated/prisma/browser";
import { activitySince } from "@/kernel/audit/audit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ListQuery } from "@/kernel/list-query/types";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as exportsModule from "@/modules/exports";
import * as invoices from "@/modules/invoices";
import * as linking from "@/modules/linking";
import * as packageModule from "@/modules/package";
import * as rates from "@/modules/rates";
import * as supplierInvoices from "@/modules/supplier-invoices";
import type { ActionItem, BriefingLine, DashboardOverview, PulseMetric } from "./types";

const D = Prisma.Decimal;

const q = (filters: ListQuery["filters"], pageSize = 1): ListQuery => ({
  page: 1,
  pageSize,
  sort: [],
  filters,
});

/** `2026-06-15` → the previous month `2026-05`. */
export function previousMonth(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The quarter before the one `today` is in: `2026-06-15` → `CH 2026/Q1`. */
export function previousQuarter(today: string): string {
  const year = Number(today.slice(0, 4));
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  return quarter === 1 ? `CH ${year - 1}/Q4` : `CH ${year}/Q${quarter - 1}`;
}

/** ISO date `days` before `today`. */
export function daysBefore(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const MAIN_ACCOUNT_ROLES: readonly string[] = ["main"];
const isMain = (b: { role: string }): boolean => MAIN_ACCOUNT_ROLES.includes(b.role);

/** The ECB working days without a cached rate over the window are a gap worth knowing (the bases depend on them). */
export const RATE_GAP_WINDOW_DAYS = 30;

export async function dashboardOverview(
  tx: TransactionClient,
  caller: CallerIdentity,
  today: string,
  since: Date | null,
): Promise<DashboardOverview> {
  const owner = can(caller, "create", "bank_transaction");
  const items: ActionItem[] = [];
  const pulse: PulseMetric[] = [];

  // --- the figures everyone reads: balances, receivables, payables, the owner's liability, the year ---
  const [balances, openInvoices, supplierKpis, ledger, yearInvoices] = await Promise.all([
    banking.accountBalances(tx),
    invoices.listInvoices(
      tx,
      q({ state: { kind: "in", values: ["issued", "sent", "partially_paid", "overdue"] } }, 20_000),
      today,
    ),
    supplierInvoices.kpis(tx, today),
    expenses.ledgerSnapshot(tx),
    invoices.listInvoices(
      tx,
      q(
        {
          type: { kind: "in", values: ["invoice", "credit_note"] },
          issueDate: { kind: "dates", from: `${today.slice(0, 4)}-01-01`, to: today },
        },
        20_000,
      ),
      today,
    ),
  ]);
  // the main accounts only (the savings account is yearly, D31)
  const mainAccounts = balances.filter((b) => isMain(b));
  for (const b of mainAccounts) {
    pulse.push({
      id: `balance:${b.bankAccountId}`,
      kind: "balance",
      label: b.label,
      value: b.balance ?? "0.00",
      currency: b.currency,
      hint: b.balanceDate,
      href: "/banking",
    });
  }
  const receivables = new Map<string, InstanceType<typeof D>>();
  let overdueCount = 0;
  for (const inv of openInvoices.rows) {
    if (inv.type === "quote") continue;
    receivables.set(inv.currency, (receivables.get(inv.currency) ?? new D(0)).plus(inv.remaining));
    if (inv.state === "overdue") overdueCount += 1;
  }
  if (receivables.size === 0) receivables.set("SEK", new D(0));
  for (const [currency, amount] of [...receivables.entries()].sort()) {
    pulse.push({
      id: `receivables:${currency}`,
      kind: "receivables",
      label: "receivables",
      value: amount.toFixed(2),
      currency,
      hint: String(openInvoices.rows.filter((r) => r.currency === currency).length),
      href: "/invoices",
    });
  }
  pulse.push({
    id: "payables",
    kind: "payables",
    label: "payables",
    value: supplierKpis.openBase,
    currency: "SEK",
    hint: String(supplierKpis.openCount),
    href: "/supplier-invoices",
  });
  pulse.push({
    id: "liability",
    kind: "liability",
    label: "liability",
    value: ledger.total.openBase,
    currency: "SEK",
    hint: String(ledger.total.openCount),
    href: "/expenses/settle",
  });
  let invoicedYear = new D(0);
  for (const inv of yearInvoices.rows) {
    if (inv.status === "draft" || !inv.totalBase) continue;
    invoicedYear = invoicedYear.plus(
      inv.type === "credit_note" ? new D(inv.totalBase).neg() : inv.totalBase,
    );
  }
  pulse.push({
    id: "invoicedYear",
    kind: "invoicedYear",
    label: "invoicedYear",
    value: invoicedYear.toFixed(2),
    currency: "SEK",
    hint: today.slice(0, 4),
    href: "/invoices",
  });

  // --- the owner's to-do ---
  if (owner) {
    const mainIds = await banking.listMainAccountIds(tx);
    const [rowsToJustify, stats, unlinkedDocs, missingReceipts, awaitingRows] = await Promise.all([
      mainIds.length
        ? banking.listTransactions(
            tx,
            q({
              state: { kind: "in", values: ["open", "partial"] },
              bankAccountId: { kind: "in", values: mainIds },
            }),
          )
        : Promise.resolve({ total: 0 }),
      documents.inboxTotals(tx, caller),
      linking.unlinkedDocuments(tx),
      expenses.listExpenses(tx, q({ hasDocument: { kind: "in", values: ["false"] } })),
      Promise.resolve(ledger.awaitingLinkCount),
    ]);
    if (rowsToJustify.total > 0) {
      items.push({
        id: "rows",
        kind: "rows_to_justify",
        count: rowsToJustify.total,
        priority: "high",
        href: "/banking/inbox",
      });
    }
    // the inbox's "need attention" (pending + ready) — the same number the inbox's title says (SC-005)
    const toReview = stats.total;
    if (toReview > 0) {
      items.push({
        id: "documents",
        kind: "documents_to_review",
        count: toReview,
        priority: "high",
        href: "/documents/inbox",
      });
    }
    if (unlinkedDocs.length > 0) {
      items.push({
        id: "unlinked-documents",
        kind: "unlinked_documents",
        count: unlinkedDocs.length,
        priority: "medium",
        href: "/banking/inbox",
      });
    }
    if (supplierKpis.overdueCount > 0) {
      items.push({
        id: "supplier-overdue",
        kind: "supplier_invoices_overdue",
        count: supplierKpis.overdueCount,
        amount: { value: supplierKpis.overdueBase, currency: "SEK" },
        priority: "high",
        href: "/supplier-invoices?f.status=in:overdue",
      });
    }
    if (supplierKpis.dueSoonCount > 0) {
      items.push({
        id: "supplier-due",
        kind: "supplier_invoices_due",
        count: supplierKpis.dueSoonCount,
        amount: { value: supplierKpis.dueSoonBase, currency: "SEK" },
        priority: "medium",
        href: "/supplier-invoices",
      });
    }
    if (overdueCount > 0) {
      items.push({
        id: "invoices-overdue",
        kind: "invoices_overdue",
        count: overdueCount,
        priority: "medium",
        href: "/invoices?f.state=in:overdue",
      });
    }
    if (ledger.total.openCount > 0) {
      items.push({
        id: "liability",
        kind: "owner_liability",
        count: ledger.total.openCount,
        amount: { value: ledger.total.openBase, currency: "SEK" },
        priority: "medium",
        href: "/expenses/settle",
      });
    }
    if (awaitingRows > 0) {
      items.push({
        id: "awaiting",
        kind: "expenses_awaiting_row",
        count: awaitingRows,
        priority: "low",
        href: "/expenses?f.status=in:awaiting_link",
      });
    }
    if (missingReceipts.total > 0) {
      items.push({
        id: "receipts",
        kind: "receipts_missing",
        count: missingReceipts.total,
        priority: "low",
        href: "/expenses?f.hasDocument=in:false",
      });
    }
    const gaps = await rates.detectGaps(
      tx,
      "EUR/SEK",
      daysBefore(today, RATE_GAP_WINDOW_DAYS),
      today,
    );
    if (gaps.length > 0) {
      items.push({
        id: "rates",
        kind: "rate_gaps",
        count: gaps.length,
        priority: "low",
        href: "/settings/rates",
      });
    }
  }

  // --- month-end and the quarter: everyone (the accountant waits for both) ---
  const lastMonth = previousMonth(today);
  const [builds, preview] = await Promise.all([
    packageModule.listBuilds(tx),
    packageModule.livePreview(tx, lastMonth, today),
  ]);
  const built = builds.some((b) => b.period === lastMonth && b.status === "built");
  if (!built || preview.flags.length > 0) {
    items.push({
      id: "package",
      kind: built ? "package_flags" : "package_not_built",
      count: preview.flags.length,
      priority: built ? "low" : "medium",
      href: "/package",
      period: lastMonth,
    });
  }
  const registrations = await exportsModule.chRegistrations(tx, caller);
  if (registrations.length > 0) {
    const quarter = previousQuarter(today);
    const declared = await exportsModule.declaredOn(tx, quarter);
    if (!declared) {
      items.push({
        id: "vat",
        kind: "vat_not_declared",
        count: 1,
        priority: "medium",
        href: `/exports?period=${encodeURIComponent(quarter)}`,
        period: quarter,
      });
    } else if (!declared.paidAt) {
      items.push({
        id: "vat-paid",
        kind: "vat_not_paid",
        count: 1,
        priority: "low",
        href: `/exports?period=${encodeURIComponent(quarter)}`,
        period: quarter,
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.priority] - order[b.priority]);

  // --- the briefing: what the trail says happened since the last visit ---
  const briefing: BriefingLine[] = since
    ? (await activitySince(tx, since)).map((a) => ({
        entityType: a.entityType,
        action: a.action,
        count: a.count,
      }))
    : [];

  return { items, pulse, briefing: { since: since ? since.toISOString() : null, lines: briefing } };
}
