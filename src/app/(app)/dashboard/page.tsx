import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { formatDateTime, formatMonth } from "@/kernel/i18n/format-date";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator, uiLanguage } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { getDashboardData, homeData, homeSentence, TICKER_DAYS } from "@/modules/dashboard";
import {
  BriefingWidget,
  CashHero,
  CurrenciesCard,
  NextMoves,
  YearStrip,
} from "@/modules/dashboard/ui";
import { getUserPreferences } from "@/modules/settings";

// Home — the year at a glance (F138, specs/dashboard US5, D76 phase 4b; the board *Pulse*, D77): the cash in the
// base with its month and its year, the situation sentence, the year's figures and justified ring; the next moves
// with the close's line (the owner's); the currencies and what is held in them; the briefing since the last visit.
// Computed on request (`homeData`).
export default async function DashboardPage() {
  const auth = await requireCaller({ action: "read", subject: "dashboard" });
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const header = await getDashboardData(prisma, tx, auth);
    const prefs = await getUserPreferences(tx, auth);
    const since = header.lastLoginAt ? new Date(header.lastLoginAt) : null;
    const home = await homeData(tx, auth, today, since);
    return { header, prefs, home };
  });
  const locale = await requestLocale(data.prefs.data?.locale);
  const t = translator(locale);
  const lang = uiLanguage(locale);
  const { header, home } = data;
  const close = home.work?.close ?? null;

  const lastLogin = header.lastLoginAt
    ? t("dashboard.lastLogin", { date: formatDateTime(header.lastLoginAt, lang) })
    : t("dashboard.firstLogin");
  const sentence = homeSentence(
    home.overview.items,
    close,
    close ? formatMonth(close.month, lang) : "",
    t,
  );

  return (
    <ListPage
      ground
      title={t("dashboard.welcome", { name: header.userName })}
      meta={header.companyName ? `${header.companyName} · ${lastLogin}` : lastLogin}
    >
      <div className="flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-stretch gap-[18px]">
          <CashHero
            cash={home.cash}
            sentence={sentence}
            metrics={home.overview.pulse.filter((m) => m.kind !== "balance")}
            year={home.year}
          />
          <NextMoves items={home.overview.items} work={home.work} />
        </div>
        <YearStrip data={home.weeks} base={home.cash.base} />
        <div className="flex flex-wrap items-stretch gap-[18px]">
          <div className="flex min-w-0 flex-[7_1_560px] flex-col">
            <BriefingWidget
              since={home.overview.briefing.since}
              lines={home.overview.briefing.lines}
            />
          </div>
          <CurrenciesCard cash={home.cash} tickers={home.currencies} days={TICKER_DAYS} />
        </div>
      </div>
    </ListPage>
  );
}
