"use client";

// The supplier invoices page's ground (F164, Pulse everywhere): the year's costs as the big number with its delta and
// spark, one sentence (what is to pay, what is late, what has no document), the four figures of the moment, the year
// split by category, then twelve months as bars. Figures from `supplierOverview` and the module's `kpis`.
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
import type { SupplierOverview } from "@/modules/supplier-invoices/overview";
import type { SupplierInvoiceKpis } from "@/modules/supplier-invoices/types";

export function SupplierInvoicesHero({
  o,
  k,
  base,
}: {
  o: SupplierOverview;
  k: SupplierInvoiceKpis;
  base: string;
}) {
  const t = useT();
  const lang = useUiLanguage();
  const year = Number(o.costYear);
  const last = o.costLastYear === null ? null : Number(o.costLastYear);
  const delta = last && last > 0 ? Math.round(((year - last) / last) * 100) : null;
  return (
    <div className="flex flex-col gap-[18px]" data-testid="supplier-invoices-hero">
      <PulseHero
        testId="supplier-invoices-year"
        eyebrow={t("supplierInvoices.hero.eyebrow", { year: o.year, base })}
        value={formatMoney(o.costYear, null, { whole: true })}
        unit={base}
        chip={
          delta !== null ? (
            // costs going up is not good news — the tone says so
            <PulseChip tone={delta <= 0 ? "done" : "attention"}>
              {delta >= 0 ? "▲" : "▼"}{" "}
              {t("supplierInvoices.hero.delta", { percent: Math.abs(delta) })}
            </PulseChip>
          ) : undefined
        }
        spark={o.months.map((m) => Number(m.base))}
        sentence={
          <>
            {k.openCount === 0 ? (
              t("supplierInvoices.hero.nothingToPay")
            ) : (
              <>
                <Emph>{t("supplierInvoices.hero.toPay", { count: k.openCount })}</Emph>{" "}
                {t("supplierInvoices.hero.for", { amount: formatMoneyCompact(k.openBase, base) })}
                {k.overdueCount > 0 && (
                  <>
                    {" — "}
                    <Emph tone="danger">
                      {t("supplierInvoices.hero.late", { count: k.overdueCount })}
                    </Emph>
                  </>
                )}
                .
              </>
            )}{" "}
            {o.missingDocuments > 0 && (
              <Emph tone="attention">
                {t("supplierInvoices.hero.missing", { count: o.missingDocuments })}
              </Emph>
            )}
          </>
        }
        aside={
          o.categories.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-2xl bg-surface-2 p-4">
              <span className="eyebrow">{t("supplierInvoices.hero.split", { year: o.year })}</span>
              <StackBar
                testId="supplier-invoices-categories"
                parts={[
                  ...o.categories.map((c) => ({
                    key: c.label,
                    label: c.label,
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
              label: t("supplierInvoices.kpi.open"),
              value: formatMoneyCompact(k.openBase, base),
              tone: k.openCount > 0 ? "attention" : "neutral",
            },
            {
              label: t("supplierInvoices.kpi.overdue"),
              value: formatMoneyCompact(k.overdueBase, base),
              tone: k.overdueCount > 0 ? "danger" : "neutral",
            },
            {
              label: t("supplierInvoices.kpi.dueSoon"),
              value: formatMoneyCompact(k.dueSoonBase, base),
            },
            {
              label: t("supplierInvoices.kpi.paidThisMonth"),
              value: formatMoneyCompact(k.paidThisMonthBase, base),
              tone: "done",
            },
          ]}
        />
      </PulseHero>
      <PulseSection
        title={t("supplierInvoices.hero.monthsTitle")}
        sub={t("supplierInvoices.hero.monthsSub", { base })}
        testId="supplier-invoices-months"
      >
        <MonthBars
          bars={o.months.map((m) => ({
            key: m.month,
            label: formatMonth(m.month, lang, "short").split(" ")[0] ?? m.month,
            value: Number(m.base),
            top: Number(m.base) !== 0 ? formatMoneyCompact(m.base) : "",
            tone: m.open ? "attention" : "neutral",
          }))}
        />
      </PulseSection>
    </div>
  );
}
