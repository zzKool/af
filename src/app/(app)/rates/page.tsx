import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { addDays } from "@/kernel/clock/calendar";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { tenantProfile } from "@/kernel/db/tenant";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { CURRENCIES } from "@/kernel/nav/constants";
import { ListPage } from "@/kernel/ui/shell/page";
import { foreignTransfers } from "@/modules/banking";
import {
  crossSeries,
  firstRateDay,
  rateCoverage,
  rateHistory,
  rateStatus,
  ratesOnDay,
} from "@/modules/rates";
import {
  CoverageCard,
  DayRatesCard,
  FetchRatesButton,
  RatesOverview,
  RatesTab,
} from "@/modules/rates/ui";
import { getUserPreferences } from "@/modules/settings";

/** the chart's longest span: five years back at most */
const MAX_DAYS = 5 * 366;

// Exchange rates (F136, spec US5, D76 phase 3): in the menu since the owner asked for it there — the ECB rates
// against the tenant's base (D39), their history, the coverage since the first stored day, the rate on a day.
// The rate table is global (no tenant data): it is read on the pool; the tenant's own transaction reads the base
// and the preferences — one after the other (one client per transaction, F53).
export default async function RatesPage() {
  const auth = await requireCaller();
  const today = createClock().today();
  const { prefs, base, transfers } = await withTenantTransaction(
    prisma,
    auth.tenantId,
    async (tx) => {
      const p = await getUserPreferences(tx, auth);
      const profile = await tenantProfile(tx, auth.tenantId);
      // F161: the owner's own transfers into the base, at the bank's rate (banking's read)
      const moves = can(auth, "read", "bank_transaction") ? await foreignTransfers(tx) : [];
      return { prefs: p, base: profile?.currency ?? CURRENCIES[0], transfers: moves };
    },
  );
  const t = translator(await requestLocale(prefs.data?.locale));

  const first = await firstRateDay(prisma);
  const from = first && first > addDays(today, -MAX_DAYS) ? first : addDays(today, -MAX_DAYS);
  const series = crossSeries(await rateHistory(prisma, from, today), base, CURRENCIES);
  const coverage = await rateCoverage(prisma, today);
  const onDay = await ratesOnDay(prisma, today, base, CURRENCIES);
  const status = await rateStatus(prisma, today);
  const canFetch = can(auth, "manage", "tenant_settings");

  return (
    <ListPage
      ground
      title={t("rates.title")}
      meta={t("rates.page.meta", { base })}
      actions={canFetch ? <FetchRatesButton missing={coverage.missingDays.length} /> : undefined}
    >
      <div className="flex flex-col gap-4">
        <RatesOverview base={base} series={series} today={today} transfers={transfers} />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <CoverageCard
            months={coverage.months}
            missingDays={coverage.missingDays}
            first={coverage.first}
            today={today}
            canFetch={false}
          />
          <DayRatesCard base={base} today={today} initial={onDay} />
        </div>
        <section
          className="flex flex-col gap-3 pulse-card px-4 py-3.5"
          aria-label={t("rates.page.pairs")}
        >
          <h2 className="text-[15px] font-semibold">{t("rates.page.pairs")}</h2>
          <RatesTab initial={status} canFetch={false} />
        </section>
      </div>
    </ListPage>
  );
}
