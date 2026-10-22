import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  chRegistrations,
  listDeclarations,
  swissVatPeriods,
  swissVatReturn,
  vatPaymentOptions,
} from "@/modules/exports";
import { SwissVatReturnPage } from "@/modules/exports/ui";
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
    const [registrations, periods, payments, declarations, prefs] = await Promise.all([
      chRegistrations(tx, auth),
      swissVatPeriods(tx, today),
      vatPaymentOptions(tx),
      listDeclarations(tx),
      getUserPreferences(tx, auth),
    ]);
    const registrationId =
      registrations.find((r) => r.id === params.registration)?.id ?? registrations[0]?.id ?? null;
    const period = periods.includes(params.period ?? "") ? (params.period as string) : periods[0];
    const initial =
      registrationId && period
        ? ((await swissVatReturn(tx, auth, { registrationId, period, today })).data ?? null)
        : null;
    return { registrations, periods, payments, declarations, prefs, initial };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));

  return (
    <ListPage
      title={t("exports.title")}
      meta={t("exports.meta", {
        periods: data.periods.length,
        declared: data.declarations.filter((d) => d.declaredAt).length,
        paid: data.declarations.filter((d) => d.paidAt).length,
      })}
    >
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
    </ListPage>
  );
}
