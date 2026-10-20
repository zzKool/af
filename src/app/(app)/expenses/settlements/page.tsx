import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { listSettlements } from "@/modules/expenses";
import { SettlementsTable } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

export default async function SettlementsPage() {
  const auth = await requireCaller({ action: "read", subject: "settlement" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [rows, prefs] = await Promise.all([listSettlements(tx), getUserPreferences(tx, auth)]);
    return { rows, prefs };
  });
  const t = translator(data.prefs.data?.locale ?? null);
  return (
    <ListPage
      title={t("expenses.settlements.title")}
      meta={t("expenses.settlements.meta", { count: data.rows.length })}
    >
      <SettlementsTable
        rows={data.rows.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          cancelledAt: s.cancelledAt ? s.cancelledAt.toISOString() : null,
        }))}
        canWrite={can(auth, "create", "settlement")}
      />
    </ListPage>
  );
}
