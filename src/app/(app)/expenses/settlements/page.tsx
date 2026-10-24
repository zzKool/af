import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { listSettlements } from "@/modules/expenses";
import { SettlementsActions, SettlementsTable } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

export default async function SettlementsPage() {
  const auth = await requireCaller({ action: "read", subject: "settlement" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const rows = await listSettlements(tx);
    const prefs = await getUserPreferences(tx, auth);
    return { rows, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "settlement");
  return (
    <ListPage
      title={t("expenses.settlements.title")}
      meta={t("expenses.settlements.meta", { count: data.rows.length })}
      actions={canWrite && <SettlementsActions />}
    >
      <SettlementsTable
        rows={data.rows.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          cancelledAt: s.cancelledAt ? s.cancelledAt.toISOString() : null,
        }))}
        canWrite={canWrite}
      />
    </ListPage>
  );
}
