"use client";

// The month card of the Close page (F155, the Pulse-Close board): the accountant's package of one month as five
// checks — each open one with the page that closes it —, what goes in the zip, and Build. Building is never
// blocked: an open check is a flag in notes.md, so *Build anyway* stays beside the primary.
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { useLocale } from "@/kernel/i18n/locale-provider";
import { uiLanguage } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import type { CloseCheck, CloseMonth, CloseZipEntry } from "@/modules/package/close";
import { periodLabel } from "@/modules/package/period";
import { isRunning } from "@/modules/package/state-family";
import type { OverviewRow } from "./package-workbench";

const ACTION: Record<CloseCheck["key"], string> = {
  bank: "/banking?new=1",
  justified: "/banking/reconcile",
  documents: "/documents",
  invoices: "/invoices",
  rates: "/rates",
};

/** `6 412 345` bytes → "6.4 MB"; small sizes in kB. */
export function fileSize(bytes: number): string {
  if (bytes >= 100_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} kB`;
}

export function CloseMonthCard({
  close,
  row,
  prev,
  next,
  lastBuilt,
  canBuild,
  building,
  onBuild,
  onDownload,
  onDetails,
}: {
  close: CloseMonth;
  /** the month's row with its live builds (polled while one runs) */
  row: OverviewRow | null;
  prev: string | null;
  next: string | null;
  /** the newest built package of any month */
  lastBuilt: { period: string; builtAt: string | null } | null;
  canBuild: boolean;
  building: boolean;
  onBuild: (period: string) => void;
  onDownload: (documentId: string) => void;
  onDetails: (period: string) => void;
}) {
  const t = useT();
  const { effectiveLocale: locale } = useLocale();
  const lang = uiLanguage(locale ?? null);
  const month = periodLabel(close.period, lang);
  const open = close.checks.filter((c) => c.open > 0).length;
  const builds = row?.builds ?? [];
  const running = builds.some(isRunning);
  const built = builds.find((b) => b.status === "built" && b.documentId) ?? null;

  return (
    <section
      className="pulse-card flex min-w-0 flex-col gap-4 p-5"
      aria-label={t("package.close.cardLabel")}
      data-testid="close-month"
      data-period={close.period}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t("package.close.cardTitle", { month })}</h2>
        <div className="flex items-center gap-1">
          <MonthLink period={prev} label={prev ? shortMonth(prev, lang) : ""} dir="prev" />
          <MonthLink period={next} label={next ? shortMonth(next, lang) : ""} dir="next" />
        </div>
      </div>

      <p
        className={
          open > 0
            ? "flex items-start gap-2 rounded-lg border border-state-attention/30 bg-state-attention/6 px-3 py-2 text-xs"
            : "flex items-start gap-2 rounded-lg border border-state-done/60 bg-state-done/12 px-3 py-2 text-xs"
        }
        data-testid="close-verdict"
      >
        <span
          className={
            open > 0
              ? "shrink-0 rounded-full bg-state-attention/15 px-2 py-0.5 font-medium text-state-attention"
              : "shrink-0 rounded-full bg-state-done/15 px-2 py-0.5 font-medium text-state-done"
          }
        >
          {open > 0 ? t("package.close.notReady") : t("package.close.ready")}
        </span>
        <span>
          {open > 0
            ? t("package.close.openChecks", { open, total: close.checks.length })
            : t("package.close.allDone")}
        </span>
      </p>

      <ul className="flex flex-col" data-testid="close-checks">
        {close.checks.map((c) => (
          <CheckRow key={c.key} check={c} month={month} />
        ))}
      </ul>

      <ZipTree close={close} />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {lastBuilt
            ? t("package.close.lastBuilt", {
                month: periodLabel(lastBuilt.period, lang),
                date: lastBuilt.builtAt?.slice(0, 10) ?? "",
              })
            : t("package.close.neverBuilt")}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="link" size="sm" onClick={() => onDetails(close.period)}>
            {t("package.close.details")}
          </Button>
          {built?.documentId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownload(built.documentId as string)}
              data-testid="close-download"
            >
              {t("package.downloadVersion", { version: built.version })}
            </Button>
          )}
          {canBuild && (
            <Button
              size="sm"
              variant={open > 0 || built ? "outline" : "default"}
              disabled={building || running}
              onClick={() => onBuild(close.period)}
              data-testid="close-build"
            >
              {running
                ? t("package.close.building")
                : built
                  ? t("package.rebuild")
                  : open > 0
                    ? t("package.close.buildAnyway")
                    : t("package.close.build")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function shortMonth(period: string, lang: string): string {
  return periodLabel(period, lang).split(" ")[0] ?? period;
}

function MonthLink({
  period,
  label,
  dir,
}: {
  period: string | null;
  label: string;
  dir: "prev" | "next";
}) {
  const t = useT();
  const body = (
    <>
      {dir === "prev" && <ChevronLeft className="size-3.5" aria-hidden />}
      {label}
      {dir === "next" && <ChevronRight className="size-3.5" aria-hidden />}
    </>
  );
  if (!period) return null;
  return (
    <Link
      href={`/package?close=${period}`}
      aria-label={t(dir === "prev" ? "package.close.prev" : "package.close.next", {
        month: label,
      })}
      scroll={false}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 gap-0.5 px-2 text-xs")}
    >
      {body}
    </Link>
  );
}

function CheckRow({ check, month }: { check: CloseCheck; month: string }) {
  const t = useT();
  const done = check.open === 0;
  const k = `package.close.check.${check.key}` as const;
  const sub =
    check.key === "rates" && check.date === null
      ? t("package.close.check.rates.none")
      : check.key !== "bank" && check.key !== "rates" && check.total === 0
        ? t("package.close.check.nothing", { month })
        : done
          ? t(`${k}.done`, {
              accounts: check.total,
              lines: check.lines ?? 0,
              total: check.total,
              date: check.date ?? "",
            })
          : t(`${k}.open`, {
              month,
              open: check.open,
              done: check.total - check.open,
              total: check.total,
              date: check.date ?? "",
            });
  return (
    <li
      className="flex items-center gap-3 border-b border-subtle py-2.5 last:border-b-0"
      data-testid="close-check"
      data-check={check.key}
      data-open={check.open}
    >
      <span
        className={
          done
            ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-state-done/15 text-state-done"
            : "flex size-5 shrink-0 items-center justify-center rounded-full bg-state-attention/15 text-[11px] font-bold text-state-attention"
        }
      >
        {done ? <Check className="size-3" aria-hidden /> : <span aria-hidden>!</span>}
        <span className="sr-only">{done ? t("package.close.done") : t("package.close.open")}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{t(`${k}.title`, { month })}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      {!done && (
        <Link
          href={ACTION[check.key]}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 shrink-0 text-xs")}
        >
          {t(`${k}.action`)}
        </Link>
      )}
    </li>
  );
}

function ZipTree({ close }: { close: CloseMonth }) {
  const t = useT();
  const noteOf = (e: CloseZipEntry) => t(`package.close.zip.${e.kind}`, { n: e.files });
  return (
    <div
      className="rounded-xl border border-subtle bg-surface-2 px-4 py-3 font-mono text-xs"
      data-testid="close-zip"
    >
      <p className="eyebrow mb-2 font-sans">{t("package.close.zip.title")}</p>
      <div className="flex justify-between gap-3">
        <span className="font-semibold">{close.period}/</span>
        <span className="text-muted-foreground">
          {close.bytes > 0
            ? t("package.close.zip.size", { files: close.files, size: fileSize(close.bytes) })
            : t("package.close.zip.files", { files: close.files })}
        </span>
      </div>
      <ul>
        {close.zip.map((e) => (
          <li key={e.name} className="flex justify-between gap-3 pl-4">
            <span className="truncate">{e.name}</span>
            <span className="shrink-0 text-muted-foreground">{noteOf(e)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
