import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  accountBalances,
  accountLabel,
  getBankAccounts,
  listImports,
  listTransactions,
  TRANSACTION_COLUMN_KEYS,
  TRANSACTION_DEFAULT_SORT,
} from "@/modules/banking";
import { TransactionTable } from "@/modules/banking/ui";
import { categoryOptions, partnerOptions } from "@/modules/journal";
import { getUserPreferences } from "@/modules/settings";

// The transactions workbench — the URL is the query, the derived state computed server-side (D20).
export default async function BankingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "bank_transaction" });
  const params = await searchParams;
  const query = parseListQuery(params, {
    columns: TRANSACTION_COLUMN_KEYS,
    defaultSort: TRANSACTION_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [result, balances, accounts, categories, partners, imports, prefs] = await Promise.all([
      listTransactions(tx, query),
      accountBalances(tx),
      getBankAccounts(tx, auth),
      categoryOptions(tx, auth),
      partnerOptions(tx),
      listImports(tx),
      getUserPreferences(tx, auth),
    ]);
    return {
      result,
      balances,
      accounts: accounts.data ?? [],
      categories,
      partners,
      imports,
      prefs,
    };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));

  return (
    <ListPage
      title={t("banking.title")}
      meta={t("banking.meta.transactions", { count: data.result.total })}
    >
      <TransactionTable
        result={{
          ...data.result,
          rows: data.result.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        }}
        balances={data.balances.map((b) => ({
          ...b,
          lastImportAt: b.lastImportAt ? b.lastImportAt.toISOString() : null,
        }))}
        accounts={data.accounts.map((a) => ({
          id: a.id,
          label: accountLabel(a),
          currency: a.currency,
        }))}
        categories={data.categories}
        partners={data.partners}
        importLabels={Object.fromEntries(data.imports.map((i) => [i.id, i.fileName]))}
        canWrite={can(auth, "create", "bank_transaction")}
        initialSelectedId={typeof params.open === "string" ? params.open : null}
      />
    </ListPage>
  );
}
