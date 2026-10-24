import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { formatDateTime } from "@/kernel/i18n/format-date";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator, uiLanguage } from "@/kernel/i18n/translate";
import { EntityPage } from "@/kernel/ui/shell/page";
import { dashboardOverview, getDashboardData } from "@/modules/dashboard";
import { ActionItemsWidget, BriefingWidget, BusinessPulseWidget } from "@/modules/dashboard/ui";
import { getUserPreferences } from "@/modules/settings";

// The dashboard (feature inventory §3.14): the action items — what to do, with the figure and the page that
// resolves it — the business pulse, the briefing since the last visit (the audit trail). Computed on request.
export default async function DashboardPage() {
  const auth = await requireCaller({ action: "read", subject: "dashboard" });
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const header = await getDashboardData(prisma, tx, auth);
    const prefs = await getUserPreferences(tx, auth);
    const since = header.lastLoginAt ? new Date(header.lastLoginAt) : null;
    const overview = await dashboardOverview(tx, auth, today, since);
    return { header, prefs, overview };
  });
  const locale = await requestLocale(data.prefs.data?.locale);
  const t = translator(locale);
  const { header, overview } = data;

  const lastLogin = header.lastLoginAt
    ? t("dashboard.lastLogin", { date: formatDateTime(header.lastLoginAt, uiLanguage(locale)) })
    : t("dashboard.firstLogin");

  return (
    <EntityPage
      title={t("dashboard.welcome", { name: header.userName })}
      meta={header.companyName ? `${header.companyName} · ${lastLogin}` : lastLogin}
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ActionItemsWidget items={overview.items} />
        <div className="flex flex-col gap-4">
          <BusinessPulseWidget metrics={overview.pulse} />
          <BriefingWidget since={overview.briefing.since} lines={overview.briefing.lines} />
        </div>
      </div>
    </EntityPage>
  );
}
