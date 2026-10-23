import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { getUserPreferences } from "@/modules/settings";
import { listRates, rateYears } from "@/modules/traktamente";
import { RateActions, RateTable, RateYearTabs } from "@/modules/traktamente/ui";

// Settings → Traktamente: the normalbelopp table per year (specs/traktamente US4).
export default async function TraktamenteSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });
  const sp = await searchParams;
  const requested = Number(Array.isArray(sp.year) ? sp.year[0] : sp.year);
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const years = await rateYears(tx);
    const year =
      Number.isInteger(requested) && requested > 2000
        ? requested
        : (years[0] ?? new Date().getFullYear());
    const [rows, prefs] = await Promise.all([listRates(tx, year), getUserPreferences(tx, auth)]);
    return { years, year, rows, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  return (
    <ListPage
      title={t("traktamente.title")}
      meta={t("traktamente.meta", { count: data.rows.length, year: data.year })}
      actions={<RateActions years={data.years} year={data.year} />}
      tabs={<RateYearTabs years={data.years} year={data.year} />}
    >
      <RateTable rows={data.rows.map(({ createdAt: _c, updatedAt: _u, ...r }) => r)} />
    </ListPage>
  );
}
