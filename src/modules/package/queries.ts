// Read API of the package module: the builds, the months with their live counts and flags (the month-end
// checklist), the live notes of one period.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { filterInMemory, finishList } from "@/kernel/list-query/memory";
import { buildDateHierarchy, countDistinct } from "@/kernel/list-query/prisma";
import type {
  DateHierarchy,
  DistinctValue,
  ListQuery,
  ListResult,
} from "@/kernel/list-query/types";
import * as banking from "@/modules/banking";
import { collectPeriod, countsOf } from "./collect";
import {
  MONTH_COLUMN_KEYS,
  MONTH_COLUMNS,
  MONTH_DEFAULT_SORT,
  type MonthColumn,
} from "./month-columns";
import { notesMd } from "./notes";
import { getBuild, toBuildDto } from "./package";
import { monthOf, monthsBetween, parsePeriod } from "./period";
import { type PeriodState, periodState } from "./state-family";
import type { PackageBuildDto, PackageFlag, PeriodOverview } from "./types";

export { getBuild };

/** Months collected live on the page; older months show their last build's figures (a full collect per month). */
export const LIVE_MONTHS = 12;

export async function listBuilds(tx: TransactionClient): Promise<PackageBuildDto[]> {
  const rows = await tx.packageBuild.findMany({
    orderBy: [{ period: "desc" }, { version: "desc" }],
  });
  return rows.map(toBuildDto);
}

/** Which of `periods` have a built package (any version) — banking's Months panel and its banner ask (F69). */
export async function builtPeriods(
  tx: TransactionClient,
  periods: readonly string[],
): Promise<Set<string>> {
  if (periods.length === 0) return new Set();
  const rows = await tx.packageBuild.findMany({
    where: { period: { in: [...periods] }, status: "built" },
    select: { period: true },
    distinct: ["period"],
  });
  return new Set(rows.map((r) => r.period));
}

/** The first month that has a bank row (ISO `YYYY-MM`), or null before the first import. */
export async function firstMonth(tx: TransactionClient): Promise<string | null> {
  const first = await banking.firstBookingDate(tx);
  return first ? monthOf(first) : null;
}

/**
 * One row per month from the first bank row to today (newest first) and one per year: the live counts and flags
 * for the latest `LIVE_MONTHS` months, the last build's otherwise; every build of the period.
 */
export async function periodOverview(
  tx: TransactionClient,
  today: string,
): Promise<PeriodOverview[]> {
  const [builds, first] = await Promise.all([listBuilds(tx), firstMonth(tx)]);
  const thisMonth = monthOf(today);
  const months = monthsBetween(first && first < thisMonth ? first : thisMonth, thisMonth);
  const byPeriod = new Map<string, PackageBuildDto[]>();
  for (const b of builds) byPeriod.set(b.period, [...(byPeriod.get(b.period) ?? []), b]);

  const out: PeriodOverview[] = [];
  for (const [i, month] of months.entries()) {
    const periodBuilds = byPeriod.get(month) ?? [];
    if (i < LIVE_MONTHS) {
      const data = await collectPeriod(tx, parsePeriod(month), today);
      out.push({
        period: month,
        kind: "month",
        counts: countsOf(data),
        flags: data.flags.length,
        builds: periodBuilds,
      });
    } else {
      const last = periodBuilds.find((b) => b.status === "built");
      out.push({
        period: month,
        kind: "month",
        counts: last?.counts ?? {
          bankRows: 0,
          invoices: 0,
          supplierInvoices: 0,
          expenses: 0,
          settlements: 0,
          documents: 0,
        },
        flags: last?.flags ?? 0,
        builds: periodBuilds,
      });
    }
  }
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  for (const year of years) {
    const periodBuilds = byPeriod.get(year) ?? [];
    const last = periodBuilds.find((b) => b.status === "built");
    const monthRows = out.filter((o) => o.kind === "month" && o.period.startsWith(year));
    out.push({
      period: year,
      kind: "year",
      counts: last?.counts ?? {
        bankRows: monthRows.reduce((s, m) => s + m.counts.bankRows, 0),
        invoices: monthRows.reduce((s, m) => s + m.counts.invoices, 0),
        supplierInvoices: monthRows.reduce((s, m) => s + m.counts.supplierInvoices, 0),
        expenses: monthRows.reduce((s, m) => s + m.counts.expenses, 0),
        settlements: monthRows.reduce((s, m) => s + m.counts.settlements, 0),
        documents: monthRows.reduce((s, m) => s + m.counts.documents, 0),
      },
      flags: last?.flags ?? monthRows.reduce((s, m) => s + m.flags, 0),
      builds: periodBuilds,
    });
  }
  return out;
}

export type LivePreview = {
  period: string;
  notes: string;
  flags: PackageFlag[];
  counts: ReturnType<typeof countsOf>;
  files: string[];
};

/** The notes and flags of a period as they would be built now — the pane of the page, before any build. */
export async function livePreview(
  tx: TransactionClient,
  period: string,
  today: string,
): Promise<LivePreview> {
  const data = await collectPeriod(tx, parsePeriod(period), today);
  return {
    period,
    notes: notesMd(data),
    flags: data.flags,
    counts: countsOf(data),
    files: data.documents.map((d) => `${d.folder}/${d.fileName}`),
  };
}

// The months of the checklist as a DataTable (F71, D20): every column is computed (live counts, flags, the
// derived state), so the filters, the sort and the page run in memory over `periodOverview`'s months — a few
// dozen rows for one company. Columns in `month-columns.ts`.

/** A period with the flat values its table columns read. */
export type PeriodRow = PeriodOverview & {
  id: string;
  /** a month's first day (`2026-06-01`); null for a year */
  month: string | null;
  state: PeriodState;
  bankRows: number;
  invoices: number;
  supplierInvoices: number;
  expenses: number;
  documents: number;
  /** the latest built version's business key */
  packageKey: string | null;
};

export function periodRow(o: PeriodOverview): PeriodRow {
  return {
    ...o,
    id: o.period,
    month: o.kind === "month" ? `${o.period}-01` : null,
    state: periodState(o),
    bankRows: o.counts.bankRows,
    invoices: o.counts.invoices,
    supplierInvoices: o.counts.supplierInvoices,
    expenses: o.counts.expenses,
    documents: o.counts.documents,
    packageKey: o.builds.find((b) => b.status === "built")?.businessKey ?? null,
  };
}

const DERIVED: ReadonlySet<string> = new Set(MONTH_COLUMN_KEYS);
const searchMonth = (row: PeriodRow, term: string) => {
  const needle = term.toLowerCase();
  return row.period.includes(needle) || (row.packageKey?.toLowerCase().includes(needle) ?? false);
};
const monthRows = (overview: PeriodOverview[], q: ListQuery, exceptColumn?: string) =>
  filterInMemory(overview.filter((o) => o.kind === "month").map(periodRow), q, MONTH_COLUMNS, {
    derived: DERIVED,
    search: searchMonth,
    exceptColumn,
  });

/** The months' page of the table — filtered, sorted, paged. */
export function listMonths(overview: PeriodOverview[], q: ListQuery): ListResult<PeriodRow> {
  return finishList(monthRows(overview, q), q, MONTH_COLUMNS, MONTH_DEFAULT_SORT);
}

export function distinctMonthValues(
  overview: PeriodOverview[],
  column: MonthColumn,
  q: ListQuery,
): DistinctValue[] {
  return countDistinct(
    monthRows(overview, q, column).map((r) => r[column]),
    MONTH_COLUMNS[column],
  );
}

export function monthDateHierarchy(
  overview: PeriodOverview[],
  column: MonthColumn,
  q: ListQuery,
): DateHierarchy {
  return MONTH_COLUMNS[column].type === "date"
    ? buildDateHierarchy(monthRows(overview, q, column).map((r) => r.month))
    : { years: [], empty: 0 };
}
