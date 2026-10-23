import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  LIVE_MONTHS,
  listMonths,
  MONTH_COLUMN_KEYS,
  MONTH_DEFAULT_SORT,
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
  const query = parseListQuery(await searchParams, {
    columns: MONTH_COLUMN_KEYS,
    defaultSort: MONTH_DEFAULT_SORT,
  });
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [overview, prefs] = await Promise.all([
      periodOverview(tx, today),
      getUserPreferences(tx, auth),
    ]);
    return { overview, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const allMonths = data.overview.filter((o) => o.kind === "month");
  const flags = allMonths.slice(0, LIVE_MONTHS).reduce((s, m) => s + m.flags, 0);
  const builds = data.overview.reduce(
    (s, o) => s + o.builds.filter((b) => b.status === "built").length,
    0,
  );
  const months = listMonths(data.overview, query);
  const initialPeriod = allMonths.find((m) => m.counts.bankRows > 0)?.period ?? null;

  return (
    <ListPage
      title={t("package.title")}
      meta={t("package.meta", { months: allMonths.length, flags, builds })}
    >
      <PackageWorkbench
        months={{ ...months, rows: months.rows.map(wire) }}
        years={data.overview.filter((o) => o.kind === "year").map((o) => wire(periodRow(o)))}
        canBuild={can(auth, "create", "accountant_package")}
        initialPeriod={initialPeriod}
      />
    </ListPage>
  );
}
