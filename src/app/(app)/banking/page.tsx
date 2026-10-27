import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { InfoBanner } from "@/kernel/ui/info-banner";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  accountBalances,
  accountLabel,
  bankMonths,
  categoryOptions,
  getBankAccounts,
  listImports,
  listTransactions,
  partnerOptions,
  TRANSACTION_COLUMN_KEYS,
  TRANSACTION_DEFAULT_SORT,
} from "@/modules/banking";
import { TransactionTable, WorkbenchActions } from "@/modules/banking/ui";
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
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listTransactions(tx, query);
    const balances = await accountBalances(tx);
    const accounts = await getBankAccounts(tx, auth);
    const categories = await categoryOptions(tx, auth);
    const partners = await partnerOptions(tx);
    const imports = await listImports(tx);
    const prefs = await getUserPreferences(tx, auth);
    const months = await bankMonths(tx, { today });
    return {
      months,
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
  const pending = data.months.banner;
  const hasRows = data.months.months.some((m) => m.justified + m.toJustify > 0);
  const canWrite = can(auth, "create", "bank_transaction");
  const accountOptions = data.accounts.map((a) => ({
    id: a.id,
    label: accountLabel(a),
    currency: a.currency,
  }));

  return (
    <ListPage
      title={t("banking.title")}
      meta={t("banking.meta.transactions", { count: data.result.total })}
      actions={<WorkbenchActions accounts={accountOptions} canWrite={canWrite} />}
      banner={
        pending && (
          <InfoBanner>
            <span data-testid="months-banner">
              {t("banking.banner.unproven", { count: pending.withoutProof, month: pending.month })}{" "}
              <Link href="/package">{t("banking.banner.openPackage")}</Link>
            </span>
          </InfoBanner>
        )
      }
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
        accounts={accountOptions}
        categories={data.categories}
        partners={data.partners}
        importLabels={Object.fromEntries(data.imports.map((i) => [i.id, i.fileName]))}
        canWrite={canWrite}
        initialSelectedId={typeof params.open === "string" ? params.open : null}
        months={hasRows ? data.months : undefined}
      />
    </ListPage>
  );
}
