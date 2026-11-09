import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { tenantProfile } from "@/kernel/db/tenant";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { CURRENCIES } from "@/kernel/nav/constants";
import { TableCard } from "@/kernel/ui/pulse";
import { ListPage } from "@/kernel/ui/shell/page";
import { listGroups } from "@/modules/expenses";
import { ExpenseGroupsHero, GroupsActions, GroupsTable } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

export default async function ExpenseGroupsPage() {
  const auth = await requireCaller({ action: "read", subject: "expense" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const groups = await listGroups(tx);
    const prefs = await getUserPreferences(tx, auth);
    const base = (await tenantProfile(tx, auth.tenantId))?.currency ?? CURRENCIES[0];
    return { groups, prefs, base };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "expense");
  return (
    <ListPage
      ground
      title={t("expenses.groups.title")}
      meta={t("expenses.groups.meta", { count: data.groups.length })}
      actions={canWrite && <GroupsActions />}
    >
      <div className="flex flex-col gap-[18px]">
        <ExpenseGroupsHero groups={data.groups} base={data.base} />
        <TableCard>
          <GroupsTable
            rows={data.groups.map((g) => ({
              ...g,
              createdAt: g.createdAt.toISOString(),
              updatedAt: g.updatedAt.toISOString(),
            }))}
            canWrite={canWrite}
          />
        </TableCard>
      </div>
    </ListPage>
  );
}
