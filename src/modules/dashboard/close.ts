// Work — the monthly close (F137, specs/dashboard US4, FR-004 – FR-005): the owner's loop as he wrote it — the
// exchange rates, the bank statements, every bank row justified, the private expenses — and the package that ends
// it, for one month. Read only: every fact comes from its owner's read model (rates, banking, expenses, package,
// invoices); the steps, the percent, the streak and the invoice reminder are derived on request, nothing stored.

import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import { stockholmDay } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ListQuery } from "@/kernel/list-query/types";
import * as banking from "@/modules/banking";
import * as expenses from "@/modules/expenses";
import * as invoices from "@/modules/invoices";
import * as packageModule from "@/modules/package";
import * as rates from "@/modules/rates";
import { dashboardOverview } from "./overview";
import {
  type ActionItem,
  type ActionKind,
  CLOSE_STEPS,
  type CloseAccount,
  type CloseStep,
  type CloseStepKind,
  type DashboardOverview,
  type InvoiceReminder,
  type MonthlyClose,
  type PastClose,
  type WorkData,
} from "./types";

/** The months *Past months* shows. */
export const PAST_MONTHS = 6;

/** The dashboard's items the close already shows as a step — *Also waiting* leaves them out. */
const CLOSE_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "rows_to_justify",
  "rate_gaps",
  "package_not_built",
]);

/** Accounts whose statement comes every month — savings come once a year (the board: *savings: yearly*). */
const MONTHLY_ROLES: ReadonlySet<string> = new Set(["main"]);

const HREF: Record<CloseStepKind, string> = {
  rates: "/rates",
  statements: "/banking?new=1",
  justified: "/banking",
  expenses: "/expenses?new=1",
  closed: "/package",
};

const monthOf = (day: string) => day.slice(0, 7);

// --- pure ---

/** The facts of one month, as the reads give them. */
export type CloseFacts = {
  month: string;
  rates: { weekdays: number; missing: number };
  accounts: readonly CloseAccount[];
  rows: { justified: number; toJustify: number };
  privateExpenses: number;
  builtOn: string | null;
};

/**
 * The five steps of a month and its percent (FR-004). A step is done on its own facts — the rates when no weekday
 * of the month misses one; the statements when every monthly account's chain reaches the month's last day; the rows
 * when none is left to justify (and the month has rows, or its statements are in); the private expenses and the
 * month itself when the package is built (nothing else can know every receipt is in). The first step not done is
 * the *current* one; the package *waits* until the four before it are done. Each step weighs a fifth.
 */
export function closeSteps(f: CloseFacts): { steps: CloseStep[]; percent: number } {
  const monthly = f.accounts;
  const complete = monthly.filter((a) => a.complete).length;
  const rowTotal = f.rows.justified + f.rows.toJustify;
  const statementsDone = monthly.length > 0 && complete === monthly.length;
  const built = f.builtOn !== null;
  const progress: Record<CloseStepKind, { done: number; total: number; ok: boolean }> = {
    rates: {
      done: f.rates.weekdays - f.rates.missing,
      total: f.rates.weekdays,
      ok: f.rates.missing === 0,
    },
    statements: { done: complete, total: monthly.length, ok: statementsDone },
    justified: {
      done: f.rows.justified,
      total: rowTotal,
      ok: f.rows.toJustify === 0 && (rowTotal > 0 || statementsDone),
    },
    expenses: { done: f.privateExpenses, total: f.privateExpenses, ok: built },
    closed: { done: built ? 1 : 0, total: 1, ok: built },
  };
  const firstOpen = CLOSE_STEPS.find((k) => !progress[k].ok);
  const fourDone = CLOSE_STEPS.slice(0, 4).every((k) => progress[k].ok);
  const steps = CLOSE_STEPS.map((kind): CloseStep => {
    const p = progress[kind];
    const state = p.ok
      ? "done"
      : kind === "closed" && !fourDone
        ? "waiting"
        : kind === firstOpen
          ? "current"
          : "todo";
    return { kind, state, done: p.done, total: p.total, href: HREF[kind] };
  });
  const fraction = (k: CloseStepKind) => {
    const p = progress[k];
    if (p.ok) return 1;
    if (k === "expenses" || k === "closed") return 0;
    return p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;
  };
  const sum = CLOSE_STEPS.reduce((s, k) => s + fraction(k), 0);
  return { steps, percent: Math.floor((sum / CLOSE_STEPS.length) * 100) };
}

/** The month Work opens on: last month until its package is built, then this month. */
export function defaultCloseMonth(today: string, built: ReadonlySet<string>): string {
  const last = banking.addMonths(monthOf(today), -1);
  return built.has(last) ? monthOf(today) : last;
}

/** The months closed in a row, back from the newest closed month before this month (last month may still be open). */
export function closeStreak(thisMonth: string, built: ReadonlySet<string>): number {
  let m = banking.addMonths(thisMonth, -1);
  if (!built.has(m)) m = banking.addMonths(m, -1);
  let n = 0;
  while (built.has(m)) {
    n += 1;
    m = banking.addMonths(m, -1);
  }
  return n;
}

/** The first day of the window in which the invoice for a month's work is issued: the 21st of that month. */
export function invoiceWindowStart(month: string): string {
  return `${month}-21`;
}

/**
 * FR-005: the clients to invoice for `month` — those with an invoice (any state, a draft counts as prepared) in the
 * month before's window and none in this month's; a window runs from the 21st of the work month to the 20th of the
 * next. Said from the window's first day on, never about a month still to come.
 */
export function invoiceReminders(
  month: string,
  today: string,
  issued: readonly { partnerId: string; partnerName: string; issueDate: string }[],
): InvoiceReminder[] {
  const start = invoiceWindowStart(month);
  if (today < start) return [];
  const prevStart = invoiceWindowStart(banking.addMonths(month, -1));
  const end = invoiceWindowStart(banking.addMonths(month, 1));
  const before = new Map<string, { partnerName: string; lastIssueDate: string }>();
  const now = new Set<string>();
  for (const i of issued) {
    if (i.issueDate >= start && i.issueDate < end) now.add(i.partnerId);
    else if (i.issueDate >= prevStart && i.issueDate < start) {
      const b = before.get(i.partnerId);
      if (!b || i.issueDate > b.lastIssueDate)
        before.set(i.partnerId, { partnerName: i.partnerName, lastIssueDate: i.issueDate });
    }
  }
  return [...before.entries()]
    .filter(([id]) => !now.has(id))
    .map(([partnerId, b]) => ({ partnerId, ...b }))
    .sort((a, b) => a.partnerName.localeCompare(b.partnerName));
}

/** Weekdays (Mon–Fri) of a month from `from` (included) to `until` (excluded). */
function weekdaysBetween(from: string, until: string): number {
  let n = 0;
  for (let d = from; d < until; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

// --- the read ---

const list = (filters: ListQuery["filters"]): ListQuery => ({
  page: 1,
  pageSize: 20_000,
  sort: [],
  filters,
});

/**
 * Everything Work shows for `month` (null = `defaultCloseMonth`): the close, the past months and the streak, the
 * dashboard's other items. The owner's page — the reads are the same the modules' own pages make.
 */
export async function workData(
  tx: TransactionClient,
  caller: CallerIdentity,
  today: string,
  month: string | null,
  /** the dashboard's overview when the caller already has it (the home) — read once */
  overview?: DashboardOverview,
): Promise<WorkData> {
  const thisMonth = monthOf(today);
  const builds = await packageModule.listBuilds(tx);
  const builtOn = new Map<string, string>();
  for (const b of builds) {
    if (b.status !== "built" || !b.builtAt || b.period.length !== 7) continue;
    const day = stockholmDay(b.builtAt);
    const seen = builtOn.get(b.period);
    if (!seen || day < seen) builtOn.set(b.period, day);
  }
  const built = new Set(builtOn.keys());
  const months = await banking.bankMonths(tx, { today });
  const first = months.from;
  const wanted = month ?? defaultCloseMonth(today, built);
  const shown = wanted < first ? first : wanted > thisMonth ? thisMonth : wanted;

  // the months the page reads: the shown one and the PAST_MONTHS before this month
  const pastMonths = banking
    .monthRange(banking.addMonths(thisMonth, -PAST_MONTHS), banking.addMonths(thisMonth, -1))
    .reverse();
  const span = [shown, ...pastMonths];
  const spanFrom = span.reduce((a, b) => (b < a ? b : a));
  const spanTo = span.reduce((a, b) => (b > a ? b : a));

  const coverage = await rates.rateCoverage(tx, today);
  const expenseRows = await expenses.listExpenses(
    tx,
    list({
      date: { kind: "dates", from: `${spanFrom}-01`, to: banking.lastDayOf(spanTo) },
      payerKind: { kind: "in", values: ["private"] },
    }),
  );
  const privateByMonth = new Map<string, number>();
  for (const e of expenseRows.rows) {
    const m = monthOf(String(e.date));
    privateByMonth.set(m, (privateByMonth.get(m) ?? 0) + 1);
  }

  const monthlyAccounts = months.accounts.filter((a) => MONTHLY_ROLES.has(a.role));
  const factsOf = (m: string): CloseFacts => {
    const c = coverage.months.find((x) => x.month === m);
    const end = `${banking.addMonths(m, 1)}-01`;
    const tomorrow = addDays(today, 1);
    const weekdays = c?.weekdays ?? weekdaysBetween(`${m}-01`, tomorrow < end ? tomorrow : end);
    let missing = !c || c.beforeFirst ? weekdays : c.missing;
    // the month the first rate falls in: its weekdays before that day have no rate either
    if (c && !c.beforeFirst && coverage.first && monthOf(coverage.first) === m)
      missing += weekdaysBetween(`${m}-01`, coverage.first);
    const row = months.months.find((x) => x.month === m);
    const last = banking.lastDayOf(m);
    return {
      month: m,
      rates: { weekdays, missing: Math.min(missing, weekdays) },
      accounts: monthlyAccounts.map((a) => ({
        label: a.label,
        currency: a.currency,
        completeTo: a.completeTo,
        complete: a.completeTo !== null && a.completeTo >= last,
      })),
      rows: { justified: row?.justified ?? 0, toJustify: row?.toJustify ?? 0 },
      privateExpenses: privateByMonth.get(m) ?? 0,
      builtOn: builtOn.get(m) ?? null,
    };
  };

  const facts = factsOf(shown);
  const { steps, percent } = closeSteps(facts);

  const issued = await invoices.listInvoices(
    tx,
    list({
      type: { kind: "in", values: ["invoice"] },
      issueDate: {
        kind: "dates",
        from: invoiceWindowStart(banking.addMonths(shown, -1)),
        to: addDays(invoiceWindowStart(banking.addMonths(shown, 1)), -1),
      },
    }),
    today,
  );
  const reminders = invoiceReminders(
    shown,
    today,
    issued.rows.map((r) => ({
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      issueDate: r.issueDate,
    })),
  );

  const close: MonthlyClose = {
    ...facts,
    accounts: [...facts.accounts],
    percent,
    steps,
    previous: shown > first ? banking.addMonths(shown, -1) : null,
    next: shown < thisMonth ? banking.addMonths(shown, 1) : null,
    reminders,
  };

  const past: PastClose[] = pastMonths
    .filter((m) => m >= first)
    .map((m) => {
      const f = factsOf(m);
      return { month: m, builtOn: f.builtOn, percent: closeSteps(f).percent };
    });

  const items = (overview ?? (await dashboardOverview(tx, caller, today, null))).items;
  const alsoWaiting: ActionItem[] = items.filter((i) => !CLOSE_KINDS.has(i.kind));

  return { close, past, streak: closeStreak(thisMonth, built), alsoWaiting };
}
