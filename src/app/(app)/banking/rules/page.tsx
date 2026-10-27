import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  categoryOptions,
  listRulesPage,
  partnerOptions,
  RULE_COLUMN_KEYS,
  RULE_DEFAULT_SORT,
} from "@/modules/banking";
import { RulesActions, RulesTable } from "@/modules/banking/ui";
import { getUserPreferences } from "@/modules/settings";

// Categorisation rules — the order they run in, new / edit / delete, apply with dry run (specs/banking US2).
export default async function BankRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "bank_transaction" });
  const query = parseListQuery(await searchParams, {
    columns: RULE_COLUMN_KEYS,
    defaultSort: RULE_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listRulesPage(tx, query);
    const categories = await categoryOptions(tx, auth);
    const partners = await partnerOptions(tx);
    const prefs = await getUserPreferences(tx, auth);
    return { result, categories, partners, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "update", "bank_transaction");

  return (
    <ListPage
      title={t("banking.rules.title")}
      meta={t("banking.rules.meta", { count: data.result.total })}
      actions={canWrite && <RulesActions categories={data.categories} partners={data.partners} />}
    >
      <RulesTable
        result={{
          ...data.result,
          rows: data.result.rows.map((r) => ({
            ...r,
            lastHitAt: r.lastHitAt ? r.lastHitAt.toISOString() : null,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
        }}
        categories={data.categories}
        partners={data.partners}
        canWrite={canWrite}
      />
    </ListPage>
  );
}
