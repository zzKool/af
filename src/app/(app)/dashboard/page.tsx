import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { formatDateTime } from "@/kernel/i18n/format-date";
import { translator } from "@/kernel/i18n/translate";
import { dashboardOverview, getDashboardData } from "@/modules/dashboard";
import { ActionItemsWidget, BriefingWidget, BusinessPulseWidget } from "@/modules/dashboard/ui";
import { getUserPreferences } from "@/modules/settings";

// The dashboard (feature inventory §3.14): the action items — what to do, with the figure and the page that
// resolves it — the business pulse, the briefing since the last visit (the audit trail). Computed on request.
export default async function DashboardPage() {
  const auth = await requireCaller({ action: "read", subject: "dashboard" });
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [header, prefs] = await Promise.all([
      getDashboardData(prisma, tx, auth),
      getUserPreferences(tx, auth),
    ]);
    const since = header.lastLoginAt ? new Date(header.lastLoginAt) : null;
    const overview = await dashboardOverview(tx, auth, today, since);
    return { header, prefs, overview };
  });
  const locale = data.prefs.data?.locale ?? null;
  const t = translator(locale);
  const { header, overview } = data;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("dashboard.welcome", { name: header.userName })}
        </h1>
        {header.companyName && <p className="text-muted-foreground">{header.companyName}</p>}
        <p className="text-sm text-muted-foreground">
          {header.lastLoginAt
            ? t("dashboard.lastLogin", { date: formatDateTime(header.lastLoginAt, locale ?? "en") })
            : t("dashboard.firstLogin")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ActionItemsWidget items={overview.items} />
        <div className="flex flex-col gap-6">
          <BusinessPulseWidget metrics={overview.pulse} />
          <BriefingWidget since={overview.briefing.since} lines={overview.briefing.lines} />
        </div>
      </div>
    </div>
  );
}
