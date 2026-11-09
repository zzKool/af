import { redirect } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import { IMPORT_COLUMN_KEYS, IMPORT_DEFAULT_SORT, listImportsPage } from "@/modules/banking";
import { ImportCsvButton, ImportsTable } from "@/modules/banking/ui";
import { getUserPreferences } from "@/modules/settings";

// The import history — one row per file (specs/banking FR-002); the URL is the query (D20).
export default async function BankImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "bank_transaction" });
  const params = await searchParams;
  if (params.new === "1") redirect("/banking/import"); // F156: the import is its own page
  const query = parseListQuery(params, {
    columns: IMPORT_COLUMN_KEYS,
    defaultSort: IMPORT_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listImportsPage(tx, query);
    const prefs = await getUserPreferences(tx, auth);
    return { result, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "bank_transaction");

  return (
    <ListPage
      title={t("banking.imports.title")}
      meta={t("banking.imports.meta", { count: data.result.total })}
      actions={canWrite && <ImportCsvButton />}
    >
      <ImportsTable
        result={{
          ...data.result,
          rows: data.result.rows.map((i) => ({ ...i, importedAt: i.importedAt.toISOString() })),
        }}
        canWrite={canWrite}
      />
    </ListPage>
  );
}
