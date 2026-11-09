"use client";

// The partners page's ground (F163, Pulse everywhere): who the company works with — the clients and what the year
// came from them, the vendors, what is open and late — as the boards' KPI tiles, and the year's split by client.
// The figures arrive from the page (the invoices module's overview); nothing derived here.
import { useT } from "@/kernel/i18n/use-t";
import { formatMoneyCompact } from "@/kernel/money/format-money";
import { Kpi, KpiRow, PulseSection, StackBar } from "@/kernel/ui/pulse";

export type PartnersFigures = {
  year: string;
  base: string;
  clients: number;
  vendors: number;
  invoicedYear: string;
  open: { count: number; base: string };
  late: { count: number; base: string };
  top: { name: string; base: string }[];
  others: string;
};

export function PartnersHero({ f }: { f: PartnersFigures }) {
  const t = useT();
  const first = f.top[0];
  const share =
    first && Number(f.invoicedYear) > 0
      ? Math.round((Number(first.base) / Number(f.invoicedYear)) * 100)
      : null;
  return (
    <div className="flex flex-col gap-[18px]" data-testid="partners-hero">
      <KpiRow>
        <Kpi
          label={t("partners.hero.clients")}
          value={f.clients}
          sub={t("partners.hero.clientsSub", { count: f.top.length, year: f.year })}
          href="/partners?f.types=in:client"
        />
        <Kpi
          label={t("partners.hero.invoiced", { year: f.year })}
          value={formatMoneyCompact(f.invoicedYear, f.base)}
          sub={
            first && share !== null
              ? t("partners.hero.top", { name: first.name, percent: share })
              : t("partners.hero.none")
          }
        />
        <Kpi
          label={t("partners.hero.open")}
          value={formatMoneyCompact(f.open.base, f.base)}
          tone={f.late.count > 0 ? "danger" : f.open.count > 0 ? "attention" : "done"}
          sub={
            f.late.count > 0
              ? t("partners.hero.late", {
                  count: f.late.count,
                  amount: formatMoneyCompact(f.late.base, f.base),
                })
              : t("partners.hero.openSub", { count: f.open.count })
          }
          href="/invoices"
        />
        <Kpi
          label={t("partners.hero.vendors")}
          value={f.vendors}
          sub={t("partners.hero.vendorsSub")}
          href="/partners?f.types=in:vendor"
        />
      </KpiRow>
      {f.top.length > 0 && (
        <PulseSection
          title={t("partners.hero.splitTitle", { year: f.year })}
          sub={t("partners.hero.splitSub", { base: f.base })}
          testId="partners-split"
        >
          <StackBar
            parts={[
              ...f.top.map((c) => ({
                key: c.name,
                label: c.name,
                value: Number(c.base),
                detail: formatMoneyCompact(c.base),
              })),
              ...(Number(f.others) > 0
                ? [{ key: "_others", label: t("invoices.hero.others"), value: Number(f.others) }]
                : []),
            ]}
          />
        </PulseSection>
      )}
    </div>
  );
}
