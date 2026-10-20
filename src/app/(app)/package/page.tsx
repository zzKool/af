import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { LIVE_MONTHS, periodOverview } from "@/modules/package";
import { PackageWorkbench } from "@/modules/package/ui";
import { getUserPreferences } from "@/modules/settings";

// The accountant package (specs/accountant-package/spec.md FR-006): the months with their live counts and flags,
// the years, the builds; Build for the owner, Download for both. Collected on request for the latest 12 months.
export default async function PackagePage() {
  const auth = await requireCaller({ action: "read", subject: "accountant_package" });
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [overview, prefs] = await Promise.all([
      periodOverview(tx, today),
      getUserPreferences(tx, auth),
    ]);
    return { overview, prefs };
  });
  const t = translator(data.prefs.data?.locale ?? null);
  const months = data.overview.filter((o) => o.kind === "month");
  const flags = months.slice(0, LIVE_MONTHS).reduce((s, m) => s + m.flags, 0);
  const builds = data.overview.reduce(
    (s, o) => s + o.builds.filter((b) => b.status === "built").length,
    0,
  );
  const initialPeriod =
    months.find((m) => m.counts.bankRows > 0)?.period ?? months[0]?.period ?? null;

  return (
    <ListPage
      title={t("package.title")}
      meta={t("package.meta", { months: months.length, flags, builds })}
    >
      <PackageWorkbench
        overview={data.overview.map((o) => ({
          ...o,
          builds: o.builds.map((b) => ({
            ...b,
            builtAt: b.builtAt ? b.builtAt.toISOString() : null,
            createdAt: b.createdAt.toISOString(),
            updatedAt: b.updatedAt.toISOString(),
          })),
        }))}
        canBuild={can(auth, "create", "accountant_package")}
        initialPeriod={initialPeriod}
      />
    </ListPage>
  );
}
