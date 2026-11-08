"use client";

// The partner page's invoicing (F144, Pulse phase 7b; the board *Partner*): four figures — invoiced this year
// against the same months last year, not invoiced yet, pays after, days billed —, twelve months of invoiced and
// paid (a bar per month, a dot with the days it took to be paid), and what happened lately. Read only; the
// figures come from `partnerInsight`.
import Link from "next/link";
import type { ReactNode } from "react";
import { formatMonth } from "@/kernel/i18n/format-date";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { cn } from "@/lib/utils";
import type { InsightEvent, PartnerInsight } from "../partner-insight";

const CARD = "rounded-2xl border border-subtle bg-surface p-4 shadow-card";
const BAR: Record<string, string> = {
  CHF: "bg-cur-chf",
  EUR: "bg-cur-eur",
  SEK: "bg-cur-sek",
  USD: "bg-cur-usd",
};
const DOT: Record<InsightEvent["kind"], string> = {
  draft: "bg-state-neutral",
  issued: "bg-action",
  sent: "bg-state-progress",
  paid: "bg-state-done",
};

function Figure({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  testId: string;
}) {
  return (
    <section className={cn(CARD, "flex flex-col gap-1")} data-testid={testId}>
      <h2 className="text-xs font-medium text-muted-foreground">{label}</h2>
      <div className="text-[22px] leading-tight font-semibold tabular-nums">{value}</div>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </section>
  );
}

export function PartnerFigures({
  insight: x,
  rate,
}: {
  insight: PartnerInsight;
  /** the active contract's rate, for *Days billed* */
  rate: { amount: string; currency: string } | null;
}) {
  const t = useT();
  const lang = useUiLanguage();
  const cur = x.currency;
  const money = (v: string) => (cur ? formatMoney(v, cur) : "—");
  const lastYear = String(Number(x.year) - 1);
  const thisMonth = Number(x.months[x.months.length - 1]?.month.slice(5, 7) ?? "1");
  const last = Number(x.invoicedLastYear);
  const change = last > 0 ? Math.round(((Number(x.invoicedYear) - last) / last) * 100) : null;
  const upTo = formatMonth(`${lastYear}-${String(thisMonth).padStart(2, "0")}`, lang, "short");

  const notYet: string[] = [];
  if (x.drafts.count > 0)
    notYet.push(
      x.drafts.newest?.periodLabel
        ? t("partners.insight.draftFor", { period: x.drafts.newest.periodLabel })
        : t("partners.insight.drafts", { count: x.drafts.count }),
    );
  if (x.notSent > 0) notYet.push(t("partners.insight.notSent", { count: x.notSent }));
  notYet.push(
    x.unpaid.count > 0
      ? t("partners.insight.unpaid", { amount: money(x.unpaid.total) })
      : t("partners.insight.nothingUnpaid"),
  );
  const elapsed = Math.max(1, thisMonth);
  const perMonth = (Number(x.daysBilledYear) / elapsed).toFixed(1);

  return (
    <div className="grid gap-[18px] sm:grid-cols-2 xl:grid-cols-4" data-testid="partner-figures">
      <Figure
        testId="partner-invoiced"
        label={t("partners.insight.invoiced", { year: x.year })}
        value={money(x.invoicedYear)}
        sub={
          change === null
            ? t("partners.insight.nothingLastYear", { upTo })
            : t(change >= 0 ? "partners.insight.up" : "partners.insight.down", {
                pct: Math.abs(change),
                upTo,
              })
        }
      />
      <Figure
        testId="partner-not-invoiced"
        label={t("partners.insight.notInvoiced")}
        value={money(x.drafts.total)}
        sub={notYet.join(" · ")}
      />
      <Figure
        testId="partner-pays-after"
        label={t("partners.insight.paysAfter")}
        value={x.stats ? t("partners.insight.days", { count: x.stats.avgDays }) : "—"}
        sub={
          !x.stats
            ? t("partners.insight.noPayment")
            : x.lateThisYear === 0
              ? t("partners.insight.neverLate", { year: x.year })
              : t("partners.insight.late", { count: x.lateThisYear, year: x.year })
        }
      />
      <Figure
        testId="partner-days-billed"
        label={t("partners.insight.daysBilled", { year: x.year })}
        value={x.daysBilledYear.replace(/\.0$/, "")}
        sub={
          rate
            ? t("partners.insight.perMonthRate", {
                perMonth,
                rate: formatMoney(rate.amount, rate.currency),
              })
            : t("partners.insight.perMonth", { perMonth })
        }
      />
    </div>
  );
}

export function PartnerMonths({ insight: x }: { insight: PartnerInsight }) {
  const t = useT();
  const lang = useUiLanguage();
  const max = Math.max(1, ...x.months.map((m) => Number(m.invoiced)));
  return (
    <section className={cn(CARD, "flex flex-col gap-3")} data-testid="partner-months">
      <div>
        <h2 className="text-sm font-semibold">{t("partners.insight.monthsTitle")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("partners.insight.monthsSub", { currency: x.currency ?? "—" })}
        </p>
      </div>
      <ol className="grid h-44 grid-cols-12 items-end gap-1.5">
        {x.months.map((m) => {
          const h = Math.max(0, Number(m.invoiced)) / max;
          return (
            <li
              key={m.month}
              className="flex h-full flex-col items-center justify-end gap-1"
              data-month={m.month}
              title={`${formatMonth(m.month, lang)} · ${x.currency ? formatMoney(m.invoiced, x.currency) : ""}`}
            >
              <span className="h-4 text-[10.5px] text-muted-foreground tabular-nums">
                {m.paidDays !== null
                  ? t("partners.insight.daysShort", { count: m.paidDays })
                  : m.open
                    ? t("partners.insight.open")
                    : ""}
              </span>
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  m.paidDays !== null ? "bg-state-done" : "bg-transparent",
                )}
              />
              <span
                className={cn(
                  "w-full max-w-9 rounded-t-md",
                  m.open ? "bg-state-attention/45" : (BAR[x.currency ?? ""] ?? "bg-action"),
                )}
                style={{ height: `${Math.round(h * 110)}px` }}
              />
              <span className="text-[11px] text-muted-foreground">
                {formatMonth(m.month, lang, "short").slice(0, 3)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function PartnerTimeline({ insight: x }: { insight: PartnerInsight }) {
  const t = useT();
  return (
    <section className={cn(CARD, "flex flex-col gap-3")} data-testid="partner-timeline">
      <div>
        <h2 className="text-sm font-semibold">{t("partners.insight.timelineTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("partners.insight.timelineSub")}</p>
      </div>
      {x.events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("partners.insight.timelineEmpty")}</p>
      ) : (
        <ol className="flex flex-col">
          {x.events.map((e) => (
            <li
              key={`${e.id}-${e.kind}`}
              className="flex items-start gap-3 border-b border-subtle py-2 last:border-b-0"
              data-kind={e.kind}
            >
              <span
                aria-hidden
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[e.kind])}
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/invoices/${e.id}`}
                  className="text-[13px] font-medium hover:underline"
                >
                  {t(`partners.insight.event.${e.kind}`, {
                    number: e.number ?? t("partners.insight.aDraft"),
                    period: e.periodLabel ? ` — ${e.periodLabel}` : "",
                  })}
                </Link>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {formatMoney(e.amount, e.currency)}
                  {e.kind === "paid" && e.days !== undefined
                    ? ` · ${t("partners.insight.paidAfter", { count: e.days })}`
                    : ""}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{e.date}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
