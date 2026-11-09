"use client";

// The subscriptions page's ground (F164, Pulse everywhere): what a month of the running subscriptions costs as the
// big number, a year of it, who takes the most, the next charges, the periods with a to-do.
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney, formatMoneyCompact } from "@/kernel/money/format-money";
import { Emph, HeroFigures, PulseHero, StackBar } from "@/kernel/ui/pulse";
import type { SubscriptionsOverview } from "@/modules/subscriptions/overview";

export function SubscriptionsHero({ o, base }: { o: SubscriptionsOverview; base: string }) {
  const t = useT();
  return (
    <PulseHero
      testId="subscriptions-hero"
      eyebrow={t("subscriptions.hero.eyebrow", { base })}
      value={formatMoney(o.perMonth, null, { whole: true })}
      unit={t("subscriptions.hero.unit", { base })}
      sentence={
        <>
          {t("subscriptions.hero.sentence", {
            count: o.active,
            year: formatMoneyCompact(o.perYear, base),
          })}{" "}
          {o.attention > 0 ? (
            <Emph tone="attention">
              {t("subscriptions.hero.attention", { count: o.attention })}
            </Emph>
          ) : (
            t("subscriptions.hero.allClear")
          )}
          {o.unpriced > 0 && (
            <span className="text-muted-foreground">
              {" "}
              {t("subscriptions.hero.unpriced", { count: o.unpriced })}
            </span>
          )}
        </>
      }
      aside={
        <div className="flex flex-col gap-3">
          {o.vendors.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-2xl bg-surface-2 p-4">
              <span className="eyebrow">{t("subscriptions.hero.who")}</span>
              <StackBar
                testId="subscriptions-vendors"
                parts={[
                  ...o.vendors.map((v) => ({
                    key: v.name,
                    label: v.name,
                    value: Number(v.perMonth),
                    detail: formatMoneyCompact(v.perMonth),
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
          )}
          {o.next.length > 0 && (
            <div
              className="flex flex-col gap-1.5 rounded-2xl bg-surface-2 p-4"
              data-testid="subscriptions-next"
            >
              <span className="eyebrow">{t("subscriptions.hero.next")}</span>
              <ul className="flex flex-col gap-1 text-[13px]">
                {o.next.map((n) => (
                  <li key={`${n.name}-${n.date}`} className="flex items-center gap-2">
                    <span className="w-[5.5rem] font-mono text-xs text-muted-foreground tabular-nums">
                      {n.date}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{n.name}</span>
                    {n.amount && n.currency && (
                      <span className="tabular-nums">{formatMoney(n.amount, n.currency)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
    >
      <HeroFigures
        items={[
          { label: t("subscriptions.hero.fig.active"), value: o.active },
          {
            label: t("subscriptions.hero.fig.year"),
            value: formatMoneyCompact(o.perYear, base),
          },
          {
            label: t("subscriptions.hero.fig.todo"),
            value: o.attention,
            tone: o.attention > 0 ? "attention" : "done",
          },
        ]}
      />
    </PulseHero>
  );
}
