import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { accountLabel, getBankAccounts, listImports } from "@/modules/banking";
import { ImportsTable } from "@/modules/banking/ui";
import { getUserPreferences } from "@/modules/settings";

// The import history — one row per file (specs/banking FR-002).
export default async function BankImportsPage() {
  const auth = await requireCaller({ action: "read", subject: "bank_transaction" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [imports, accounts, prefs] = await Promise.all([
      listImports(tx),
      getBankAccounts(tx, auth),
      getUserPreferences(tx, auth),
    ]);
    return { imports, accounts: accounts.data ?? [], prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));

  return (
    <ListPage
      title={t("banking.imports.title")}
      back={<Link href="/banking">← {t("banking.title")}</Link>}
      meta={t("banking.imports.meta", { count: data.imports.length })}
    >
      <ImportsTable
        imports={data.imports.map((i) => ({ ...i, importedAt: i.importedAt.toISOString() }))}
        accounts={data.accounts.map((a) => ({
          id: a.id,
          label: accountLabel(a),
          currency: a.currency,
        }))}
        canWrite={can(auth, "create", "bank_transaction")}
      />
    </ListPage>
  );
}
