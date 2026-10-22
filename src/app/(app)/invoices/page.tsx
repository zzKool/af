import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import { INVOICE_COLUMN_KEYS, INVOICE_DEFAULT_SORT, listInvoices } from "@/modules/invoices";
import { InvoiceTable } from "@/modules/invoices/ui";
import { getPartners } from "@/modules/partners";
import { getUserPreferences } from "@/modules/settings";

// Quotes, invoices and credit notes — the URL is the query, derived states computed server-side (D20).
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "invoice" });
  const query = parseListQuery(await searchParams, {
    columns: INVOICE_COLUMN_KEYS,
    defaultSort: INVOICE_DEFAULT_SORT,
  });
  const today = createClock().today();
  const { result, clients, prefs } = await withTenantTransaction(
    prisma,
    auth.tenantId,
    async (tx) => {
      const [result, clients, prefs] = await Promise.all([
        listInvoices(tx, query, today),
        getPartners(tx, { types: ["client"], includeInactive: true }),
        getUserPreferences(tx, auth),
      ]);
      return { result, clients: clients.data ?? [], prefs };
    },
  );
  const t = translator(await requestLocale(prefs.data?.locale));

  return (
    <ListPage title={t("invoices.title")} meta={t("invoices.meta.count", { count: result.total })}>
      <InvoiceTable
        result={{
          ...result,
          rows: result.rows.map((r) => ({
            ...r,
            issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
            sentAt: r.sentAt ? r.sentAt.toISOString() : null,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
        }}
        partnerNames={Object.fromEntries(clients.map((c) => [c.id, c.name]))}
        canWrite={can(auth, "create", "invoice")}
      />
    </ListPage>
  );
}
