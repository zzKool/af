"use client";

// `/package` (specs/accountant-package/spec.md FR-006): the months with their live counts and flags — the month-end
// checklist — and the years; *Build* (owner) queues the job and the row follows it; *Download* the built versions;
// the right pane previews what the package would say today (flags, documents, notes.md) before any build.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { getDocumentDownloadUrlAction } from "@/modules/documents/ui";
import {
  buildPackageAction,
  listPackageBuildsAction,
  packagePreviewAction,
} from "@/modules/package/package.actions";
import { periodLabel } from "@/modules/package/period";
import type { LivePreview } from "@/modules/package/queries";
import type {
  FlagKind,
  PackageBuildDto,
  PackageFlag,
  PeriodOverview,
} from "@/modules/package/types";

/** The DTO over the wire: dates as strings. */
export type BuildRow = Omit<PackageBuildDto, "builtAt" | "createdAt" | "updatedAt"> & {
  builtAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type OverviewRow = Omit<PeriodOverview, "builds"> & { builds: BuildRow[] };

const FLAG_ORDER: FlagKind[] = [
  "missing_document",
  "unlinked_row",
  "delta",
  "unpaid_invoice",
  "document_not_ready",
];

const STATUS_STYLE: Record<BuildRow["status"], string> = {
  queued: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  building: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  built: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const toRow = (b: PackageBuildDto): BuildRow => ({
  ...b,
  builtAt: b.builtAt ? String(b.builtAt) : null,
  createdAt: String(b.createdAt),
  updatedAt: String(b.updatedAt),
});

const isRunning = (b: BuildRow) => b.status === "queued" || b.status === "building";

export function PackageWorkbench({
  overview,
  canBuild,
  initialPeriod,
}: {
  overview: OverviewRow[];
  canBuild: boolean;
  /** the period selected on arrival (the first month with rows) */
  initialPeriod: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const { effectiveLocale: locale } = useLocale();
  const lang = uiLanguage(locale ?? null);
  const [rows, setRows] = useState(overview);
  const [seen, setSeen] = useState(overview);
  if (seen !== overview) {
    setSeen(overview);
    setRows(overview);
  }
  const [selected, setSelected] = useState<string | null>(initialPeriod);
  const [preview, setPreview] = useState<LivePreview | null>(null);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const { executeAsync: build, isPending: building } = useAction(buildPackageAction);
  const { executeAsync: listBuilds } = useAction(listPackageBuildsAction);
  const { executeAsync: loadPreview } = useAction(packagePreviewAction);
  const { executeAsync: downloadUrl } = useAction(getDocumentDownloadUrlAction);

  // the preview of the selected period, collected on request
  useEffect(() => {
    if (!selected || selected === previewFor) return;
    let cancelled = false;
    setPreview(null);
    void (async () => {
      const r = await loadPreview({ period: selected });
      if (cancelled) return;
      const error = extractError(r);
      if (error) {
        toast.error(error);
        return;
      }
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (d) {
        setPreview(d);
        setPreviewFor(selected);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, previewFor, loadPreview]);

  // while a build runs, re-read the builds every two seconds; announce the outcome
  const running = rows.some((r) => r.builds.some(isRunning));
  const [polls, setPolls] = useState(0);
  const refreshBuilds = useCallback(async () => {
    const r = await listBuilds();
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!d) return;
    const fresh = d.map(toRow);
    setRows((current) => {
      const next = current.map((row) => ({
        ...row,
        builds: fresh.filter((b) => b.period === row.period),
      }));
      for (const row of current) {
        for (const was of row.builds) {
          const now = fresh.find((b) => b.id === was.id);
          if (!now || !isRunning(was) || isRunning(now)) continue;
          if (now.status === "built") {
            toast.success(t("package.done", { key: now.businessKey, flags: now.flags }));
          } else if (now.status === "failed") {
            toast.error(t("package.failedWith", { error: now.error ?? "" }));
          }
          router.refresh();
        }
      }
      return next;
    });
  }, [listBuilds, router, t]);
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
    setRows((current) =>
      current.map((row) =>
        row.period === period ? { ...row, builds: [toRow(d), ...row.builds] } : row,
      ),
    );
  }

  async function download(documentId: string) {
    const r = await downloadUrl({ documentId });
    const error = extractError(r);
    if (error) return toast.error(error);
    const url = r?.data?.data?.downloadUrl;
    if (url) window.open(url, "_blank", "noopener");
  }

  const months = rows.filter((r) => r.kind === "month");
  const years = rows.filter((r) => r.kind === "year");
  const selectedRow = rows.find((r) => r.period === selected) ?? null;

  function periodTable(list: OverviewRow[], title: string) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">{t("package.col.period")}</TableHead>
                <TableHead className="w-16 text-right" title={t("package.col.bankRows")}>
                  {t("package.col.bankRowsShort")}
                </TableHead>
                <TableHead className="w-16 text-right" title={t("package.col.invoices")}>
                  {t("package.col.invoicesShort")}
                </TableHead>
                <TableHead className="w-16 text-right" title={t("package.col.supplierInvoices")}>
                  {t("package.col.supplierInvoicesShort")}
                </TableHead>
                <TableHead className="w-16 text-right" title={t("package.col.expenses")}>
                  {t("package.col.expensesShort")}
                </TableHead>
                <TableHead className="w-16 text-right" title={t("package.col.documents")}>
                  {t("package.col.documentsShort")}
                </TableHead>
                <TableHead className="w-16 text-right">{t("package.col.flags")}</TableHead>
                <TableHead className="w-32">{t("package.col.package")}</TableHead>
                {canBuild && (
                  <TableHead className="w-24">
                    <span className="sr-only">{t("package.build")}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((row) => {
                const latest = row.builds[0] ?? null;
                const lastBuilt = row.builds.find((b) => b.status === "built") ?? null;
                return (
                  <TableRow
                    key={row.period}
                    data-testid="package-period"
                    data-period={row.period}
                    data-state={row.period === selected ? "selected" : undefined}
                    className={`cursor-pointer ${row.period === selected ? "bg-muted/60" : ""}`}
                    onClick={() => setSelected(row.period)}
                  >
                    <TableCell className="font-medium">{periodLabel(row.period, lang)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.counts.bankRows}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.counts.invoices}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.counts.supplierInvoices}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.counts.expenses}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.counts.documents}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge
                        variant="outline"
                        className={
                          row.flags === 0
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                        }
                        data-testid="package-flags"
                      >
                        {row.flags}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {latest && isRunning(latest) ? (
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid="package-running"
                        >
                          {t(latest.status === "queued" ? "package.queued" : "package.building")}
                        </span>
                      ) : lastBuilt?.documentId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          title={lastBuilt.businessKey}
                          onClick={(e) => {
                            e.stopPropagation();
                            void download(lastBuilt.documentId as string);
                          }}
                          data-testid="package-download"
                        >
                          v{lastBuilt.version} ↓
                        </Button>
                      ) : latest?.status === "failed" ? (
                        <span className="text-xs text-red-700" data-testid="package-failed">
                          {t("package.failed")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("package.noBuild")}
                        </span>
                      )}
                    </TableCell>
                    {canBuild && (
                      <TableCell>
                        <Button
                          size="sm"
                          disabled={building || (latest !== null && isRunning(latest))}
                          onClick={(e) => {
                            e.stopPropagation();
                            void requestBuild(row.period);
                          }}
                          data-testid="package-build"
                        >
                          {lastBuilt ? t("package.rebuild") : t("package.build")}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-6">
        {periodTable(months, t("package.months"))}
        {years.length > 0 && (
          <div className="flex flex-col gap-2">
            {periodTable(years, t("package.years"))}
            <p className="text-xs text-muted-foreground">{t("package.year.hint")}</p>
          </div>
        )}
      </div>

      <section
        className="flex flex-col gap-4"
        aria-label={t("package.preview.notes")}
        data-testid="package-preview"
      >
        {selectedRow ? (
          <>
            <h2 className="text-sm font-medium">
              {t("package.preview.title", { period: periodLabel(selectedRow.period, lang) })}
            </h2>
            {preview === null || previewFor !== selected ? (
              <p className="text-sm text-muted-foreground">{t("package.preview.loading")}</p>
            ) : (
              <>
                <FlagList flags={preview.flags} />
                <section>
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                    {t("package.preview.files", { count: preview.files.length })}
                  </h3>
                  <ul className="max-h-48 overflow-auto rounded-md border px-3 py-2 font-mono text-xs">
                    {preview.files.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                    {preview.files.length === 0 && <li className="text-muted-foreground">—</li>}
                  </ul>
                </section>
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    {t("package.preview.notes")}
                  </summary>
                  <pre
                    className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border px-3 py-2 text-xs"
                    data-testid="package-notes"
                  >
                    {preview.notes}
                  </pre>
                </details>
              </>
            )}
            <section>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                {t("package.preview.builds")}
              </h3>
              {selectedRow.builds.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("package.noBuild")}</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {selectedRow.builds.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5"
                      data-testid="package-version"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge variant="outline" className={STATUS_STYLE[b.status]}>
                          {t(`package.status.${b.status}`)}
                        </Badge>
                        <span className="truncate font-mono text-xs" title={b.error ?? undefined}>
                          {b.businessKey}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
                        {b.builtAt ? new Date(b.builtAt).toLocaleString(locale ?? undefined) : ""}
                        {b.status === "built" && <span>{b.flags} ⚑</span>}
                        {b.documentId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void download(b.documentId as string)}
                            data-testid="package-version-download"
                          >
                            {t("package.download")}
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </section>
    </div>
  );
}

function FlagList({ flags }: { flags: PackageFlag[] }) {
  const t = useT();
  return (
    <section data-testid="package-flag-list">
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">
        {t("package.preview.flags", { count: flags.length })}
      </h3>
      {flags.length === 0 ? (
        <p className="text-sm">{t("package.preview.noFlags")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {FLAG_ORDER.filter((k) => flags.some((f) => f.kind === k)).map((kind) => (
            <div key={kind}>
              <div className="text-xs font-medium">{t(`package.flag.${kind}`)}</div>
              <ul className="text-sm">
                {flags
                  .filter((f) => f.kind === kind)
                  .map((f) => (
                    <li key={`${f.entity}:${f.id}:${f.kind}`} className="truncate" title={f.detail}>
                      <span className="font-mono text-xs">{f.key}</span>
                      <span className="text-muted-foreground"> — {f.detail}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
