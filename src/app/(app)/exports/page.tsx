import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { Kpi, KpiRow } from "@/kernel/ui/pulse";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  chRegistrations,
  listDeclarations,
  swissVatPeriods,
  swissVatReturn,
  vatPaymentOptions,
  vatQuarterCard,
} from "@/modules/exports";
import { SwissVatReturnPage, VatQuarterCard } from "@/modules/exports/ui";
import { getUserPreferences } from "@/modules/settings";

// The Swiss VAT return (specs/exports/spec.md): per CH registration and quarter, the FTA form from the read
// models, the declaration record. Owner declares; the accountant reads.
export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; registration?: string }>;
}) {
  const auth = await requireCaller({ action: "read", subject: "accountant_package" });
  const params = await searchParams;
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const registrations = await chRegistrations(tx, auth);
    const periods = await swissVatPeriods(tx, today);
    const payments = await vatPaymentOptions(tx);
    const declarations = await listDeclarations(tx);
    const prefs = await getUserPreferences(tx, auth);
    const registrationId =
      registrations.find((r) => r.id === params.registration)?.id ?? registrations[0]?.id ?? null;
    const period = periods.includes(params.period ?? "") ? (params.period as string) : periods[0];
    const initial =
      registrationId && period
        ? ((await swissVatReturn(tx, auth, { registrationId, period, today })).data ?? null)
        : null;
    // F165: the hero — the quarter to act on (the Close page's card), the quarters as tiles
    const quarter = await vatQuarterCard(tx, auth, today);
    return { registrations, periods, payments, declarations, prefs, initial, quarter };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));

  return (
    <ListPage
      ground
      title={t("exports.title")}
      meta={t("exports.meta", {
        periods: data.periods.length,
        declared: data.declarations.filter((d) => d.declaredAt).length,
        paid: data.declarations.filter((d) => d.paidAt).length,
      })}
    >
      <div className="flex flex-col gap-[18px]">
        <div className="grid items-stretch gap-[18px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <VatQuarterCard card={data.quarter} />
          <KpiRow testId="exports-hero" pairs>
            <Kpi
              label={t("exports.pulse.quarters")}
              value={data.periods.length}
              sub={t("exports.pulse.quartersSub")}
            />
            <Kpi
              label={t("exports.pulse.declared")}
              value={data.declarations.filter((d) => d.declaredAt).length}
              tone="done"
              sub={t("exports.pulse.declaredSub")}
            />
            <Kpi
              label={t("exports.pulse.paid")}
              value={data.declarations.filter((d) => d.paidAt).length}
              tone="done"
              sub={t("exports.pulse.paidSub")}
            />
            <Kpi
              label={t("exports.pulse.toDeclare")}
              value={Math.max(
                0,
                data.periods.length - 1 - data.declarations.filter((d) => d.declaredAt).length,
              )}
              tone={
                data.periods.length - 1 - data.declarations.filter((d) => d.declaredAt).length > 0
                  ? "attention"
                  : "done"
              }
              sub={t("exports.pulse.toDeclareSub")}
            />
          </KpiRow>
        </div>
        <section className="pulse-card p-6">
          <SwissVatReturnPage
            registrations={data.registrations}
            periods={data.periods}
            payments={data.payments}
            initial={
              data.initial
                ? {
                    ...data.initial,
                    declaration: data.initial.declaration
                      ? {
                          ...data.initial.declaration,
                          createdAt: data.initial.declaration.createdAt.toISOString(),
                          updatedAt: data.initial.declaration.updatedAt.toISOString(),
                        }
                      : null,
                  }
                : null
            }
            canWrite={can(auth, "create", "accountant_package")}
          />
        </section>
      </div>
    </ListPage>
  );
}
