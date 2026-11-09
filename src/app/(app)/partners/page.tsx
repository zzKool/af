import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { tenantProfile } from "@/kernel/db/tenant";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { CURRENCIES } from "@/kernel/nav/constants";
import { TableCard } from "@/kernel/ui/pulse";
import { ListPage } from "@/kernel/ui/shell/page";
import { invoicesOverview } from "@/modules/invoices";
import {
  getPartners,
  listPartners,
  PARTNER_COLUMN_KEYS,
  PARTNER_DEFAULT_SORT,
} from "@/modules/partners";
import { NewPartnerButton, PartnersHero, PartnerTable } from "@/modules/partners/ui";
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

  const today = createClock().today();
  const { result, prefs, figures } = await withTenantTransaction(
    prisma,
    auth.tenantId,
    async (tx) => {
      const result = await listPartners(tx, query);
      const prefs = await getUserPreferences(tx, auth);
      // F163: the hero — clients and vendors, the year's invoicing by client (the invoices module's overview)
      const clients = await getPartners(tx, { types: ["client"] });
      const vendors = await getPartners(tx, { types: ["vendor"] });
      const o = await invoicesOverview(tx, today);
      const base = (await tenantProfile(tx, auth.tenantId))?.currency ?? CURRENCIES[0];
      const figures = {
        year: o.year,
        base,
        clients: clients.data?.length ?? 0,
        vendors: vendors.data?.length ?? 0,
        invoicedYear: o.invoicedYear,
        open: o.open,
        late: { count: o.overdue.count, base: o.overdue.base },
        top: o.clients,
        others: o.others,
      };
      return { result, prefs, figures };
    },
  );
  const t = translator(await requestLocale(prefs.data?.locale));

  return (
    <ListPage
      ground
      title={t("partners.title")}
      meta={t("partners.meta.count", { count: result.total })}
      actions={<NewPartnerButton />}
    >
      <div className="flex flex-col gap-[18px]">
        <PartnersHero f={figures} />
        <TableCard>
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
        </TableCard>
      </div>
    </ListPage>
  );
}
