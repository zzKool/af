// The dashboard's read model (feature inventory §3.14; specs/dashboard/spec.md): the action items — what the owner
// has to do, each with the count behind it and the page that resolves it — the business pulse (the figures of the
// moment) and the briefing since the last visit, read from the audit trail. Everything comes from the modules'
// read models; nothing here is stored. Owner and accountant see the same page; the accountant's items are the
// read-only ones (the package, the declarations).
import { Prisma } from "@/generated/prisma/browser";
import { activitySince } from "@/kernel/audit/audit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import { addDays } from "@/kernel/clock/calendar";
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
import * as subscriptions from "@/modules/subscriptions";
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

/**
 * The quarter before the one `today` is in: `2026-06-15` → `CH 2026/Q1`. The name is the exports' (the stored
 * `declaration_period`): the period of the last day of the previous quarter.
 */
export function previousQuarter(today: string): string {
  const month = Number(today.slice(5, 7));
  const quarterStart = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
  return exportsModule.periodOfDate(addDays(quarterStart, -1));
}

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
  const mainIds = await banking.listMainAccountIds(tx);
  const balances = await banking.accountBalances(tx);
  const openInvoices = await invoices.listInvoices(
    tx,
    q({ state: { kind: "in", values: ["issued", "sent", "partially_paid", "overdue"] } }, 20_000),
    today,
  );
  const supplierKpis = await supplierInvoices.kpis(tx, today);
  const ledger = await expenses.ledgerSnapshot(tx);
  const yearInvoices = await invoices.listInvoices(
    tx,
    q(
      {
        type: { kind: "in", values: ["invoice", "credit_note"] },
        issueDate: { kind: "dates", from: `${today.slice(0, 4)}-01-01`, to: today },
      },
      20_000,
    ),
    today,
  );
  // the main accounts only (the savings account is yearly, D31) — banking says which are main
  const mainAccounts = balances.filter((b) => mainIds.includes(b.bankAccountId));
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
  // receivables are issued invoices only — a quote is no claim, a credit note already reduced its original (F57)
  const receivables = new Map<string, InstanceType<typeof D>>();
  const openCount = new Map<string, number>();
  let overdueCount = 0;
  for (const inv of openInvoices.rows) {
    if (inv.type !== "invoice") continue;
    receivables.set(inv.currency, (receivables.get(inv.currency) ?? new D(0)).plus(inv.remaining));
    openCount.set(inv.currency, (openCount.get(inv.currency) ?? 0) + 1);
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
      hint: String(openCount.get(currency) ?? 0),
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
    // a count, not the workbench's list (F82): the main accounts' open | partial rows
    const rowsToJustify = await banking.rowsToJustifyCount(tx);
    const stats = await documents.inboxTotals(tx, caller);
    const unlinkedDocs = await linking.unlinkedDocuments(tx);
    const missingReceipts = await expenses.listExpenses(
      tx,
      q({ hasDocument: { kind: "in", values: ["false"] } }),
    );
    const awaitingRows = ledger.awaitingLinkCount;
    if (rowsToJustify > 0) {
      items.push({
        id: "rows",
        kind: "rows_to_justify",
        count: rowsToJustify,
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
        // what the KPI counts: open, not overdue, due by today + DUE_SOON_DAYS
        href: `/supplier-invoices?f.status=in:unpaid|partially_paid&f.dueDate=dates:from=${today}|to=${addDays(today, supplierInvoices.DUE_SOON_DAYS)}`,
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
    // F94 US6: the subscription periods that need the owner — to confirm, a charge missing, a receipt / bill missing.
    // An overdue supplier-invoice period is not counted: the supplier-invoices item above already is.
    const subs = await subscriptions.attentionCounts(tx, caller, today);
    if (subs.periods > 0) {
      items.push({
        id: "subscriptions",
        kind: "subscriptions_attention",
        count: subs.periods,
        params: {
          toConfirm: subs.toConfirm,
          chargeMissing: subs.chargeMissing,
          documentMissing: subs.documentMissing,
        },
        priority: "medium",
        href: "/subscriptions?f.attention=range:1:",
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
    // every fetched pair, the trailing gap included — the same legs `rateToBase` refuses on (F81);
    // the count is ECB days without a rate in any pair, each day once
    const gaps = await rates.rateGaps(tx, today, { windowDays: RATE_GAP_WINDOW_DAYS });
    const missingDays = new Set(gaps.flatMap((g) => g.missingDays));
    if (missingDays.size > 0) {
      items.push({
        id: "rates",
        kind: "rate_gaps",
        count: missingDays.size,
        priority: "low",
        href: "/settings/rates",
      });
    }
  }

  // --- month-end and the quarter: everyone (the accountant waits for both) ---
  const lastMonth = previousMonth(today);
  const builds = await packageModule.listBuilds(tx);
  // the flags only, not the whole package preview (F83)
  const flags = await packageModule.periodFlags(tx, lastMonth, today);
  const built = builds.some((b) => b.period === lastMonth && b.status === "built");
  if (!built || flags.length > 0) {
    items.push({
      id: "package",
      kind: built ? "package_flags" : "package_not_built",
      count: flags.length,
      priority: built ? "low" : "medium",
      href: "/package",
      period: lastMonth,
    });
  }
  // the quarter is declared per CH registration (F56): each one has its own declaration, and its own item
  const registrations = await exportsModule.chRegistrations(tx, caller);
  const quarter = previousQuarter(today);
  for (const reg of registrations) {
    const declared = await exportsModule.declaredOn(tx, quarter, reg.id);
    if (declared?.paidAt) continue;
    const href = `/exports?period=${encodeURIComponent(quarter)}&registration=${reg.id}`;
    items.push(
      declared
        ? {
            id: `vat-paid:${reg.id}`,
            kind: "vat_not_paid",
            count: 1,
            priority: "low",
            href,
            period: quarter,
          }
        : {
            id: `vat:${reg.id}`,
            kind: "vat_not_declared",
            count: 1,
            priority: "medium",
            href,
            period: quarter,
          },
    );
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
