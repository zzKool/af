import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { accountLabel, getBankAccounts } from "@/modules/banking";
import { ImportWorkbench } from "@/modules/banking/ui";
import { getUserPreferences } from "@/modules/settings";

// Import a bank statement (F156, the Pulse-Import board): drop the files → check the preview (the four tiles, what
// happens to the new rows, every row's *Will be*) → imported. Its own page since F156; `?new=1` on /banking and
// /banking/imports lands here (+ New → Import bank CSV, F73).
export default async function BankImportPage() {
  const auth = await requireCaller({ action: "create", subject: "bank_transaction" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const accounts = await getBankAccounts(tx, auth);
    const prefs = await getUserPreferences(tx, auth);
    return { accounts: accounts.data ?? [], prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));

  return (
    <ListPage ground title={t("banking.import.pageTitle")} meta={t("banking.import.pageMeta")}>
      <ImportWorkbench
        accounts={data.accounts.map((a) => ({
          id: a.id,
          label: accountLabel(a),
          currency: a.currency,
        }))}
      />
    </ListPage>
  );
}
