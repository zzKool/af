import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import { listPartners, PARTNER_COLUMN_KEYS, PARTNER_DEFAULT_SORT } from "@/modules/partners";
import { NewPartnerButton, PartnerTable } from "@/modules/partners/ui";
import { getUserPreferences } from "@/modules/settings";

// The reference list page (D19, D20): the URL is the query, the server loads one page, the client
// table changes the URL. Nothing is fetched client-side except header filter values.
export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "manage", subject: "partner" });
  const query = parseListQuery(await searchParams, {
    columns: PARTNER_COLUMN_KEYS,
    defaultSort: PARTNER_DEFAULT_SORT,
  });

  const { result, prefs } = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listPartners(tx, query);
    const prefs = await getUserPreferences(tx, auth);
    return { result, prefs };
  });
  const t = translator(await requestLocale(prefs.data?.locale));

  return (
    <ListPage
      title={t("partners.title")}
      meta={t("partners.meta.count", { count: result.total })}
      actions={<NewPartnerButton />}
    >
      <PartnerTable
        result={{
          ...result,
          rows: result.rows.map((p) => ({
            ...p,
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
          })),
        }}
      />
    </ListPage>
  );
}
