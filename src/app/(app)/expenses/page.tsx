import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
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
import { ExpenseTable } from "@/modules/expenses/ui";
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
    const [result, ledger, options, prefs] = await Promise.all([
      listExpenses(tx, query),
      ledgerSnapshot(tx),
      expensePageOptions(tx, auth),
      getUserPreferences(tx, auth),
    ]);
    return { result, ledger, options, prefs };
  });
  const t = translator(data.prefs.data?.locale ?? null);

  return (
    <ListPage
      title={t("expenses.title")}
      meta={t("expenses.meta.count", { count: data.result.total })}
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
