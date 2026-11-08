import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { formatMonth } from "@/kernel/i18n/format-date";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator, uiLanguage } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { leftSentence, workData } from "@/modules/dashboard";
import { MonthlyCloseView, WorkMonthNav } from "@/modules/dashboard/ui";
import { getUserPreferences } from "@/modules/settings";

// Work — the monthly close (F137, specs/dashboard US4, D76 phase 4): the owner's four steps and the package for
// one month, *Also waiting*, the past months. `?month=yyyy-mm` picks the month; without it, last month until its
// package is built. The owner's page: the accountant reads the package, the loop is not his.
export default async function WorkRoute({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const auth = await requireCaller({ action: "create", subject: "bank_transaction" });
  const today = createClock().today();
  const asked = (await searchParams).month;
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : null;
  const { prefs, work } = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const p = await getUserPreferences(tx, auth);
    const w = await workData(tx, auth, today, month);
    return { prefs: p, work: w };
  });
  const locale = await requestLocale(prefs.data?.locale);
  const t = translator(locale);
  const name = formatMonth(work.close.month, uiLanguage(locale));

  return (
    <ListPage
      ground
      title={t("work.title", { month: name, percent: work.close.percent })}
      meta={
        <>
          <span className="font-medium text-foreground">{t("work.eyebrow")}</span> ·{" "}
          {leftSentence(work.close, name, t)}
        </>
      }
      actions={<WorkMonthNav close={work.close} />}
    >
      <MonthlyCloseView
        close={work.close}
        past={work.past}
        streak={work.streak}
        alsoWaiting={work.alsoWaiting}
      />
    </ListPage>
  );
}
