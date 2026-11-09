import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { tenantProfile } from "@/kernel/db/tenant";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { CURRENCIES } from "@/kernel/nav/constants";
import { TableCard } from "@/kernel/ui/pulse";
import { ListPage } from "@/kernel/ui/shell/page";
import { ledgerSnapshot, listSettlements } from "@/modules/expenses";
import { SettlementsActions, SettlementsHero, SettlementsTable } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

export default async function SettlementsPage() {
  const auth = await requireCaller({ action: "read", subject: "settlement" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const rows = await listSettlements(tx);
    const prefs = await getUserPreferences(tx, auth);
    const ledger = await ledgerSnapshot(tx);
    const base = (await tenantProfile(tx, auth.tenantId))?.currency ?? CURRENCIES[0];
    return { rows, prefs, ledger, base };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "settlement");
  return (
    <ListPage
      ground
      title={t("expenses.settlements.title")}
      meta={t("expenses.settlements.meta", { count: data.rows.length })}
      actions={canWrite && <SettlementsActions />}
    >
      <div className="flex flex-col gap-[18px]">
        <SettlementsHero
          rows={data.rows}
          owed={data.ledger.total.openBase}
          owedCount={data.ledger.total.openCount}
          base={data.base}
          year={createClock().today().slice(0, 4)}
        />
        <TableCard>
          <SettlementsTable
            rows={data.rows.map((s) => ({
              ...s,
              createdAt: s.createdAt.toISOString(),
              updatedAt: s.updatedAt.toISOString(),
              cancelledAt: s.cancelledAt ? s.cancelledAt.toISOString() : null,
            }))}
            canWrite={canWrite}
          />
        </TableCard>
      </div>
    </ListPage>
  );
}
