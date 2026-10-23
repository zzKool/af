"use client";

// `/package` (specs/accountant-package/spec.md FR-006): the months as a DataTable — the month-end checklist, each
// with its derived state, live counts and flags (Month quick filter, ⋮ Build / Download) — then the years; a row
// opens the docked panel with what the package would say today and its versions. While a build runs the builds
// are re-read every two seconds and the outcome announced.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import { useLocale } from "@/kernel/i18n/locale-provider";
import { uiLanguage } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import type { DateHierarchy, DistinctValue, ListResult } from "@/kernel/list-query/types";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  type RowAction,
  RowActionsMenu,
  useListQuery,
} from "@/kernel/ui/data-table";
import { StateLabel } from "@/kernel/ui/state-label";
import { CodeChip } from "@/kernel/ui/tags";
import { getDocumentDownloadUrlAction } from "@/modules/documents/ui";
import { MONTH_COLUMN_KEYS, MONTH_DEFAULT_SORT } from "@/modules/package/month-columns";
import {
  buildPackageAction,
  distinctPackageMonthsAction,
  listPackageBuildsAction,
  packageMonthDatesAction,
} from "@/modules/package/package.actions";
import { periodLabel } from "@/modules/package/period";
import type { PeriodRow } from "@/modules/package/queries";
import {
  isRunning,
  PERIOD_STATE_FAMILY,
  PERIOD_STATES,
  periodState,
} from "@/modules/package/state-family";
import type { PackageBuildDto } from "@/modules/package/types";
import { PackagePanel } from "./package-panel";

/** The DTO over the wire: dates as ISO strings. */
export type BuildRow = Omit<PackageBuildDto, "builtAt" | "createdAt" | "updatedAt"> & {
  builtAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type OverviewRow = Omit<PeriodRow, "builds"> & { builds: BuildRow[] };

const iso = (d: Date | string) => new Date(d).toISOString();
const toRow = (b: PackageBuildDto): BuildRow => ({
  ...b,
  builtAt: b.builtAt ? iso(b.builtAt) : null,
  createdAt: iso(b.createdAt),
  updatedAt: iso(b.updatedAt),
});

type Answer<T> = { data?: { data?: T } | { error: { message: string } } } | undefined;
const unwrap = <T,>(r: Answer<T>, fallback: T): T => {
  const d = r?.data;
  if (d && "error" in d) throw new Error(d.error.message);
  return d?.data ?? fallback;
};

export function PackageWorkbench({
  months,
  years,
  canBuild,
  initialPeriod,
}: {
  /** the months' page of the table (filtered, sorted, paged on the server) */
  months: ListResult<OverviewRow>;
  years: OverviewRow[];
  canBuild: boolean;
  /** the period whose panel is open on arrival (the newest month with rows) */
  initialPeriod: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const { effectiveLocale: locale } = useLocale();
  const lang = uiLanguage(locale ?? null);
  const state = useListQuery({ columns: MONTH_COLUMN_KEYS, defaultSort: MONTH_DEFAULT_SORT });
  // the builds as last polled, by period — over the server's rows until the next refresh brings them
  const [polled, setPolled] = useState<Map<string, BuildRow[]> | null>(null);
  const [seen, setSeen] = useState({ months, years });
  if (seen.months !== months || seen.years !== years) {
    setSeen({ months, years });
    setPolled(null);
  }
  const [selected, setSelected] = useState<string | null>(initialPeriod);
  const { executeAsync: build, isPending: building } = useAction(buildPackageAction);
  const { executeAsync: listBuilds } = useAction(listPackageBuildsAction);
  const { executeAsync: downloadUrl } = useAction(getDocumentDownloadUrlAction);

  const live = useCallback(
    (row: OverviewRow): OverviewRow => {
      const builds = polled?.get(row.period) ?? row.builds;
      if (builds === row.builds) return row;
      const withBuilds = { ...row, builds };
      return {
        ...withBuilds,
        state: periodState(withBuilds),
        packageKey: builds.find((b) => b.status === "built")?.businessKey ?? null,
      };
    },
    [polled],
  );
  const monthRows = useMemo(() => months.rows.map(live), [months.rows, live]);
  const yearRows = useMemo(() => years.map(live), [years, live]);
  const all = useMemo(() => [...monthRows, ...yearRows], [monthRows, yearRows]);
  const selectedRow = all.find((r) => r.period === selected) ?? null;

  // while a build runs, re-read the builds every two seconds; announce the outcome
  const running = all.some((r) => r.builds.some(isRunning));
  const [polls, setPolls] = useState(0);
  const refreshBuilds = useCallback(async () => {
    const r = await listBuilds();
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!d) return;
    const fresh = d.map(toRow);
    let finished = false;
    for (const row of all) {
      for (const was of row.builds) {
        const now = fresh.find((b) => b.id === was.id);
        if (!now || !isRunning(was) || isRunning(now)) continue;
        finished = true;
        if (now.status === "built") {
          toast.success(t("package.done", { key: now.businessKey, flags: now.flags }));
        } else if (now.status === "failed") {
          toast.error(t("package.failedWith", { error: now.error ?? "" }));
        }
      }
    }
    const byPeriod = new Map<string, BuildRow[]>();
    for (const row of all) byPeriod.set(row.period, []);
    for (const b of fresh) byPeriod.get(b.period)?.push(b);
    setPolled(byPeriod);
    if (finished) router.refresh();
  }, [all, listBuilds, router, t]);
  useEffect(() => {
    if (!running || polls > 300) return;
    const h = setTimeout(async () => {
      setPolls((n) => n + 1);
      await refreshBuilds();
    }, 2000);
    return () => clearTimeout(h);
  }, [running, polls, refreshBuilds]);

  async function requestBuild(period: string) {
    const r = await build({ period });
    const error = extractError(r);
    if (error) return toast.error(error);
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!d) return;
    toast.success(t("package.requested", { period: periodLabel(period, lang) }));
    setPolls(0);
    setPolled((current) => {
      const next = new Map(current ?? all.map((row) => [row.period, row.builds]));
      next.set(period, [toRow(d), ...(next.get(period) ?? [])]);
      return next;
    });
  }

  async function download(documentId: string) {
    const r = await downloadUrl({ documentId });
    const error = extractError(r);
    if (error) return toast.error(error);
    const url = r?.data?.data?.downloadUrl;
    if (url) window.open(url, "_blank", "noopener");
  }

  function rowActions(row: OverviewRow): RowAction[] {
    const latest = row.builds[0] ?? null;
    const lastBuilt = row.builds.find((b) => b.status === "built" && b.documentId) ?? null;
    const actions: RowAction[] = [];
    if (canBuild)
      actions.push({
        label: lastBuilt ? t("package.rebuild") : t("package.build"),
        disabled: building || (latest !== null && isRunning(latest)),
        onClick: () => void requestBuild(row.period),
      });
    if (lastBuilt?.documentId)
      actions.push({
        label: t("package.downloadVersion", { version: lastBuilt.version }),
        onClick: () => void download(lastBuilt.documentId as string),
      });
    return actions;
  }

  const filterSource = useMemo<DataTableFilterSource>(
    () => ({
      distinct: async (column, query) =>
        unwrap<DistinctValue[]>(
          await distinctPackageMonthsAction({ column: column as never, query }),
          [],
        ),
      dateHierarchy: async (column, query) =>
        unwrap<DateHierarchy>(await packageMonthDatesAction({ column: column as never, query }), {
          years: [],
          empty: 0,
        }),
    }),
    [],
  );

  const cells = useMemo(
    () => ({
      period: (row: OverviewRow) => (
        <span className="font-medium" data-testid="package-period" data-period={row.period}>
          {periodLabel(row.period, lang)}
        </span>
      ),
      state: (row: OverviewRow) => (
        <StateLabel
          family={PERIOD_STATE_FAMILY[row.state]}
          state={t(`package.state.${row.state}`)}
        />
      ),
      flags: (row: OverviewRow) => (
        <span className="tabular-nums" data-testid="package-flags">
          {row.flags}
        </span>
      ),
      packageKey: (row: OverviewRow) =>
        row.packageKey ? (
          <CodeChip>{row.packageKey}</CodeChip>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    }),
    [t, lang],
  );

  const columns = useMemo<DataTableColumn<OverviewRow>[]>(
    () => [
      {
        key: "month",
        header: t("package.col.month"),
        type: "date",
        width: "10rem",
        alwaysVisible: true,
        quickFilter: true,
        cell: cells.period,
      },
      {
        key: "state",
        header: t("package.col.state"),
        type: "enum",
        width: "10rem",
        cell: cells.state,
      },
      { key: "bankRows", header: t("package.col.bankRows"), type: "number", width: "7.5rem" },
      { key: "invoices", header: t("package.col.invoices"), type: "number", width: "6.5rem" },
      {
        key: "supplierInvoices",
        header: t("package.col.supplierInvoices"),
        type: "number",
        width: "8rem",
      },
      { key: "expenses", header: t("package.col.expenses"), type: "number", width: "6.5rem" },
      { key: "documents", header: t("package.col.documents"), type: "number", width: "7rem" },
      {
        key: "flags",
        header: t("package.col.flags"),
        type: "number",
        width: "5.5rem",
        cell: cells.flags,
      },
      {
        key: "packageKey",
        header: t("package.col.package"),
        type: "text",
        width: "13rem",
        cell: cells.packageKey,
      },
    ],
    [t, cells],
  );

  return (
    <div className="flex flex-col gap-6">
      <DataTable
        tableKey="package-months"
        columns={columns}
        result={{ ...months, rows: monthRows }}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) =>
          value === null
            ? t("common.blanks")
            : column === "state" && (PERIOD_STATES as readonly string[]).includes(value)
              ? t(`package.state.${value as OverviewRow["state"]}`)
              : value
        }
        onRowClick={(row) => setSelected(row.period)}
        rowActions={rowActions}
        emptyState={t("package.empty")}
      />

      {yearRows.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={t("package.years")}>
          <h2 className="text-[13px] font-semibold">{t("package.years")}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("package.col.period")}</TableHead>
                <TableHead>{t("package.col.state")}</TableHead>
                <TableHead className="text-right">{t("package.col.bankRows")}</TableHead>
                <TableHead className="text-right">{t("package.col.invoices")}</TableHead>
                <TableHead className="text-right">{t("package.col.supplierInvoices")}</TableHead>
                <TableHead className="text-right">{t("package.col.expenses")}</TableHead>
                <TableHead className="text-right">{t("package.col.documents")}</TableHead>
                <TableHead className="text-right">{t("package.col.flags")}</TableHead>
                <TableHead>{t("package.col.package")}</TableHead>
                <TableHead className="w-9">
                  <span className="sr-only">{t("table.rowActions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {yearRows.map((row) => (
                <TableRow
                  key={row.period}
                  className="cursor-pointer border-b border-subtle"
                  onClick={() => setSelected(row.period)}
                >
                  <TableCell>{cells.period(row)}</TableCell>
                  <TableCell>{cells.state(row)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.bankRows}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.invoices}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.supplierInvoices}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.expenses}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.documents}</TableCell>
                  <TableCell className="text-right">{cells.flags(row)}</TableCell>
                  <TableCell>{cells.packageKey(row)}</TableCell>
                  <TableCell>
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: the trigger inside is a real button */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: it only stops the row's click */}
                    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu label={t("table.rowActions")} actions={rowActions(row)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">{t("package.year.hint")}</p>
        </section>
      )}

      <PackagePanel
        row={selectedRow}
        canBuild={canBuild}
        building={building}
        onBuild={(period) => void requestBuild(period)}
        onDownload={(id) => void download(id)}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
