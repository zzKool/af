import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { tenantProfile } from "@/kernel/db/tenant";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { CURRENCIES } from "@/kernel/nav/constants";
import { expensePageOptions, phoneSummary } from "@/modules/expenses";
import { PhoneCapture } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

// Snap a receipt (F142, the board *Phone*): the groups, categories and payers the expense needs, the base, and the
// summary the saved step shows (what the company owes, the receipts still missing). Computed on request.
export default async function PhonePage() {
  const auth = await requireCaller({ action: "create", subject: "expense" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const options = await expensePageOptions(tx, auth, { documents: false, transactions: false });
    const summary = await phoneSummary(tx, auth);
    const base = (await tenantProfile(tx, auth.tenantId))?.currency ?? CURRENCIES[0];
    const prefs = await getUserPreferences(tx, auth);
    return { options, summary, base, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  return (
    <main className="flex flex-col gap-3">
      <h1 className="mx-auto w-full max-w-md text-2xl font-bold tracking-tight">
        {t("phone.title")}
      </h1>
      <PhoneCapture
        groups={data.options.groups}
        categories={data.options.categories}
        sources={data.options.sources}
        base={data.base}
        initialSummary={data.summary}
      />
    </main>
  );
}
