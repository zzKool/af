"use client";

// The expenses sub-pages' ground (F164, Pulse everywhere): the groups — how many, the trips, what they cost, what
// the company still owes you, where it went — and the settlements — refunded this year, still owed, the FX the
// refunds made. The figures are the lists' own rows, summed here for the display (whole units, compact).
import { useT } from "@/kernel/i18n/use-t";
import { formatMoneyCompact } from "@/kernel/money/format-money";
import { Kpi, KpiRow, PulseSection, StackBar } from "@/kernel/ui/pulse";

type GroupFig = {
  id: string;
  label: string;
  totalBase: string;
  openBase: string;
  hasTrip: boolean;
};

const sum = (xs: readonly string[]) => xs.reduce((s, x) => s + Number(x), 0).toFixed(2);

export function ExpenseGroupsHero({ groups, base }: { groups: GroupFig[]; base: string }) {
  const t = useT();
  const total = sum(groups.map((g) => g.totalBase));
  const open = sum(groups.map((g) => g.openBase));
  const withOpen = groups.filter((g) => Number(g.openBase) > 0).length;
  const ranked = [...groups].sort((a, b) => Number(b.totalBase) - Number(a.totalBase));
  return (
    <div className="flex flex-col gap-[18px]" data-testid="expense-groups-hero">
      <KpiRow>
        <Kpi
          label={t("expenses.pulse.groups")}
          value={groups.length}
          sub={t("expenses.pulse.groupsSub")}
        />
        <Kpi
          label={t("expenses.pulse.trips")}
          value={groups.filter((g) => g.hasTrip).length}
          sub={t("expenses.pulse.tripsSub")}
        />
        <Kpi
          label={t("expenses.pulse.spent")}
          value={formatMoneyCompact(total, base)}
          sub={t("expenses.pulse.spentSub")}
        />
        <Kpi
          label={t("expenses.pulse.owed")}
          value={formatMoneyCompact(open, base)}
          tone={Number(open) > 0 ? "attention" : "done"}
          sub={t("expenses.pulse.owedSub", { count: withOpen })}
          href="/expenses/settle"
        />
      </KpiRow>
      {ranked.length > 0 && Number(total) > 0 && (
        <PulseSection
          title={t("expenses.pulse.whereTitle")}
          sub={t("expenses.pulse.whereSub", { base })}
        >
          <StackBar
            testId="expense-groups-split"
            parts={[
              ...ranked.slice(0, 5).map((g) => ({
                key: g.id,
                label: g.label,
                value: Number(g.totalBase),
                detail: formatMoneyCompact(g.totalBase),
              })),
              ...(ranked.length > 5
                ? [
                    {
                      key: "_others",
                      label: t("invoices.hero.others"),
                      value: Number(sum(ranked.slice(5).map((g) => g.totalBase))),
                    },
                  ]
                : []),
            ]}
          />
        </PulseSection>
      )}
    </div>
  );
}

type SettlementFig = {
  bookingDate: string;
  refundBase: string;
  differenceBase: string;
  rounding: boolean;
  status: string;
};

export function SettlementsHero({
  rows,
  owed,
  owedCount,
  base,
  year,
}: {
  rows: SettlementFig[];
  owed: string;
  owedCount: number;
  base: string;
  year: string;
}) {
  const t = useT();
  const live = rows.filter((r) => r.status !== "cancelled");
  const thisYear = live.filter((r) => r.bookingDate.startsWith(year));
  const fx = Number(sum(live.filter((r) => !r.rounding).map((r) => r.differenceBase)));
  return (
    <KpiRow testId="settlements-hero">
      <Kpi
        label={t("expenses.pulse.refunded", { year })}
        value={formatMoneyCompact(sum(thisYear.map((r) => r.refundBase)), base)}
        tone="done"
        sub={t("expenses.pulse.refundedSub", { count: thisYear.length })}
      />
      <Kpi
        label={t("expenses.pulse.owed")}
        value={formatMoneyCompact(owed, base)}
        tone={Number(owed) > 0 ? "attention" : "done"}
        sub={t("expenses.pulse.owedLines", { count: owedCount })}
        href="/expenses/settle"
      />
      <Kpi
        label={t("expenses.pulse.settlements")}
        value={live.length}
        sub={t("expenses.pulse.settlementsSub")}
      />
      <Kpi
        label={t("expenses.pulse.fx")}
        value={formatMoneyCompact(fx.toFixed(2), base)}
        tone={fx < 0 ? "attention" : "neutral"}
        sub={t("expenses.pulse.fxSub")}
      />
    </KpiRow>
  );
}
