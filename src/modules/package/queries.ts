// Read API of the package module: the builds, the months with their live counts and flags (the month-end
// checklist), the live notes of one period.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { collectPeriod, countsOf } from "./collect";
import { notesMd } from "./notes";
import { getBuild, toBuildDto } from "./package";
import { monthOf, monthsBetween, parsePeriod } from "./period";
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

/** The first month that has a bank row (ISO `YYYY-MM`), or null before the first import. */
export async function firstMonth(tx: TransactionClient): Promise<string | null> {
  const first = await tx.bankTransaction.findFirst({
    orderBy: { bookingDate: "asc" },
    select: { bookingDate: true },
  });
  return first ? monthOf(first.bookingDate.toISOString()) : null;
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
