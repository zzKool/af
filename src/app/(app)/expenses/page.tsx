import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  EXPENSE_COLUMN_KEYS,
  EXPENSE_DEFAULT_SORT,
  expensePageOptions,
  ledgerSnapshot,
  listExpenses,
} from "@/modules/expenses";
import { ExpensesActions, ExpenseTable } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

// The expenses list (specs/expenses US5) — the URL is the query, the status derived server-side.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "expense" });
  const params = await searchParams;
  const query = parseListQuery(params, {
    columns: EXPENSE_COLUMN_KEYS,
    defaultSort: EXPENSE_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listExpenses(tx, query);
    const ledger = await ledgerSnapshot(tx);
    const options = await expensePageOptions(tx, auth);
    const prefs = await getUserPreferences(tx, auth);
    return { result, ledger, options, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const { groups, categories, sources, documents } = data.options;

  return (
    <ListPage
      title={t("expenses.title")}
      meta={t("expenses.meta.count", { count: data.result.total })}
      actions={
        <ExpensesActions
          options={{ groups, categories, sources, documents }}
          canWrite={can(auth, "create", "expense")}
        />
      }
    >
      <ExpenseTable
        result={{
          ...data.result,
          rows: data.result.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        }}
        ledger={data.ledger}
        {...data.options}
        canWrite={can(auth, "create", "expense")}
        initialSelectedId={typeof params.open === "string" ? params.open : null}
      />
    </ListPage>
  );
}
