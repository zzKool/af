import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { listGroups } from "@/modules/expenses";
import { GroupsActions, GroupsTable } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

export default async function ExpenseGroupsPage() {
  const auth = await requireCaller({ action: "read", subject: "expense" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [groups, prefs] = await Promise.all([listGroups(tx), getUserPreferences(tx, auth)]);
    return { groups, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "expense");
  return (
    <ListPage
      title={t("expenses.groups.title")}
      meta={t("expenses.groups.meta", { count: data.groups.length })}
      actions={canWrite && <GroupsActions />}
    >
      <GroupsTable
        rows={data.groups.map((g) => ({
          ...g,
          createdAt: g.createdAt.toISOString(),
          updatedAt: g.updatedAt.toISOString(),
        }))}
        canWrite={canWrite}
      />
    </ListPage>
  );
}
