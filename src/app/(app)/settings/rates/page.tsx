import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { translator } from "@/kernel/i18n/translate";
import { rateStatus } from "@/modules/rates";
import { RatesTab } from "@/modules/rates/ui";
import { getUserPreferences } from "@/modules/settings";

// Settings → Exchange rates: the ECB pairs, their newest day and coverage; *Fetch now* for the owner.
// The table is global (no tenant data), so the accountant reads it too.
export default async function RatesSettingsPage() {
  const auth = await requireCaller();
  const today = createClock().today();
  const [status, prefs] = await Promise.all([
    rateStatus(prisma, today),
    withTenantTransaction(prisma, auth.tenantId, (tx) => getUserPreferences(tx, auth)),
  ]);
  const t = translator(prefs.data?.locale ?? null);
  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-1 text-2xl font-semibold">{t("rates.title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("rates.meta")}</p>
      <RatesTab initial={status} canFetch={can(auth, "manage", "tenant_settings")} />
    </div>
  );
}
