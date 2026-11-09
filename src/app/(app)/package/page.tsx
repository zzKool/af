import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import { vatQuarterCard } from "@/modules/exports";
import { VatQuarterCard } from "@/modules/exports/ui";
import {
  closeMonthOf,
  isPackagePeriod,
  LIVE_MONTHS,
  listMonths,
  MONTH_COLUMN_KEYS,
  MONTH_DEFAULT_SORT,
  monthOf,
  type PeriodRow,
  periodOverview,
  periodRow,
} from "@/modules/package";
import { type OverviewRow, PackageWorkbench } from "@/modules/package/ui";
import { getUserPreferences } from "@/modules/settings";

/** The builds' dates as ISO strings for the client. */
const wire = (r: PeriodRow): OverviewRow => ({
  ...r,
  builds: r.builds.map((b) => ({
    ...b,
    builtAt: b.builtAt ? b.builtAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  })),
});

// The accountant package (specs/accountant-package/spec.md FR-006): the months with their live counts, flags and
// state — a DataTable whose URL is the query (D20) —, the years, the builds; Build for the owner, Download for
// both. Collected on request for the latest 12 months.
export default async function PackagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "accountant_package" });
  const params = await searchParams;
  const query = parseListQuery(params, {
    columns: MONTH_COLUMN_KEYS,
    defaultSort: MONTH_DEFAULT_SORT,
  });
  const today = createClock().today();
  const thisMonth = monthOf(today);
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const overview = await periodOverview(tx, today);
    const prefs = await getUserPreferences(tx, auth);
    // the month the card shows: `?close=2026-07`, else the month just ended (the one to send)
    const months = overview.filter((o) => o.kind === "month").map((o) => o.period);
    const asked = typeof params.close === "string" ? params.close : "";
    const period =
      isPackagePeriod(asked) && asked.length === 7 && months.includes(asked)
        ? asked
        : (months[1] ?? months[0] ?? thisMonth);
    const closeMonth = await closeMonthOf(tx, period, today);
    const vat = await vatQuarterCard(tx, auth, today);
    return { overview, prefs, months, period, closeMonth, vat };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const allMonths = data.overview.filter((o) => o.kind === "month");
  const flags = allMonths.slice(0, LIVE_MONTHS).reduce((s, m) => s + m.flags, 0);
  const builds = data.overview.reduce(
    (s, o) => s + o.builds.filter((b) => b.status === "built").length,
    0,
  );
  const months = listMonths(data.overview, query);
  // newest first: the month before is the next one down, the month after the one above
  const at = data.months.indexOf(data.period);
  const closeRow = data.overview.find((o) => o.kind === "month" && o.period === data.period);
  const lastBuilt = data.overview
    .filter((o) => o.kind === "month")
    .flatMap((o) => o.builds.filter((b) => b.status === "built"))
    .sort((a, b) => (b.builtAt?.getTime() ?? 0) - (a.builtAt?.getTime() ?? 0))[0];

  return (
    <ListPage
      ground
      title={t("package.close.title")}
      meta={
        <>
          {t("package.close.meta")} {t("package.meta", { months: allMonths.length, flags, builds })}
        </>
      }
    >
      <PackageWorkbench
        months={{ ...months, rows: months.rows.map(wire) }}
        years={data.overview.filter((o) => o.kind === "year").map((o) => wire(periodRow(o)))}
        canBuild={can(auth, "create", "accountant_package")}
        initialPeriod={null}
        close={{
          month: data.closeMonth,
          row: closeRow ? wire(periodRow(closeRow)) : null,
          prev: at >= 0 ? (data.months[at + 1] ?? null) : null,
          next: at > 0 ? (data.months[at - 1] ?? null) : null,
          lastBuilt: lastBuilt
            ? { period: lastBuilt.period, builtAt: lastBuilt.builtAt?.toISOString() ?? null }
            : null,
        }}
        aside={<VatQuarterCard card={data.vat} />}
      />
    </ListPage>
  );
}
