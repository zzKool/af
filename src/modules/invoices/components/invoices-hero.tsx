"use client";

// The invoices page's ground (F163, Pulse everywhere): the year invoiced as the big number with its delta and spark,
// the sentence (open, late — the oldest named — drafts), the year's figures, who it came from, then twelve months
// as bars. Read only; every figure is `invoicesOverview`'s.
import { formatMonth } from "@/kernel/i18n/format-date";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { formatMoney, formatMoneyCompact } from "@/kernel/money/format-money";
import {
  Emph,
  HeroFigures,
  MonthBars,
  PulseChip,
  PulseHero,
  PulseSection,
  StackBar,
} from "@/kernel/ui/pulse";
import type { InvoicesOverview } from "@/modules/invoices/overview";

export function InvoicesHero({ o, base }: { o: InvoicesOverview; base: string }) {
  const t = useT();
  const lang = useUiLanguage();
  const year = Number(o.invoicedYear);
  const last = o.invoicedLastYear === null ? null : Number(o.invoicedLastYear);
  const delta = last && last > 0 ? Math.round(((year - last) / last) * 100) : null;
  const short = (m: string) => formatMonth(m, lang, "short").split(" ")[0] ?? m;

  return (
    <div className="flex flex-col gap-[18px]" data-testid="invoices-hero">
      <PulseHero
        testId="invoices-year"
        eyebrow={t("invoices.hero.eyebrow", { year: o.year, base })}
        value={formatMoney(o.invoicedYear, null, { whole: true })}
        unit={base}
        chip={
          delta !== null ? (
            <PulseChip tone={delta >= 0 ? "done" : "attention"}>
              {delta >= 0 ? "▲" : "▼"} {t("invoices.hero.delta", { percent: Math.abs(delta) })}
            </PulseChip>
          ) : undefined
        }
        spark={o.months.map((m) => Number(m.base))}
        sentence={
          o.open.count === 0 ? (
            <>{t("invoices.hero.allPaid")}</>
          ) : (
            <>
              <Emph>{t("invoices.hero.open", { count: o.open.count })}</Emph>{" "}
              {t("invoices.hero.openFor", { amount: formatMoneyCompact(o.open.base, base) })}
              {o.overdue.count > 0 && o.overdue.oldest ? (
                <>
                  {" — "}
                  <Emph tone="danger">{t("invoices.hero.late", { count: o.overdue.count })}</Emph>
                  {", "}
                  {t("invoices.hero.oldest", {
                    number: o.overdue.oldest.number,
                    days: o.overdue.oldest.days,
                  })}
                </>
              ) : (
                <> — {t("invoices.hero.noneLate")}</>
              )}
            </>
          )
        }
        aside={
          o.clients.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-2xl bg-surface-2 p-4">
              <span className="eyebrow">{t("invoices.hero.clients", { year: o.year })}</span>
              <StackBar
                testId="invoices-clients"
                parts={[
                  ...o.clients.map((c) => ({
                    key: c.name,
                    label: c.name,
                    value: Number(c.base),
                    detail: formatMoneyCompact(c.base),
                  })),
                  ...(Number(o.others) > 0
                    ? [
                        {
                          key: "_others",
                          label: t("invoices.hero.others"),
                          value: Number(o.others),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          )
        }
      >
        <HeroFigures
          items={[
            {
              label: t("invoices.hero.fig.open"),
              value: formatMoneyCompact(o.open.base, base),
              tone: o.open.count > 0 ? "attention" : "neutral",
              testId: "invoices-fig-open",
            },
            {
              label: t("invoices.hero.fig.late"),
              value: formatMoneyCompact(o.overdue.base, base),
              tone: o.overdue.count > 0 ? "danger" : "neutral",
              testId: "invoices-fig-late",
            },
            {
              label: t("invoices.hero.fig.drafts"),
              value: o.drafts.count,
              testId: "invoices-fig-drafts",
            },
            {
              label: t("invoices.hero.fig.paid", { year: o.year }),
              value: o.paidYear,
              tone: "done",
              testId: "invoices-fig-paid",
            },
          ]}
        />
      </PulseHero>

      <PulseSection
        title={t("invoices.hero.monthsTitle")}
        sub={t("invoices.hero.monthsSub", { base })}
        testId="invoices-months"
      >
        <MonthBars
          bars={o.months.map((m) => ({
            key: m.month,
            label: short(m.month),
            value: Number(m.base),
            top: Number(m.base) !== 0 ? formatMoneyCompact(m.base) : "",
            tone: m.open ? "attention" : "progress",
          }))}
        />
      </PulseSection>
    </div>
  );
}
