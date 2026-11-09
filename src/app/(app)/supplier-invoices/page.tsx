import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
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
import { getUserPreferences } from "@/modules/settings";
import {
  kpis,
  listSupplierInvoices,
  SUPPLIER_INVOICE_COLUMN_KEYS,
  SUPPLIER_INVOICE_DEFAULT_SORT,
  supplierInvoicePageOptions,
  supplierOverview,
} from "@/modules/supplier-invoices";
import {
  NewSupplierInvoiceButton,
  SupplierInvoicesHero,
  SupplierInvoiceTable,
} from "@/modules/supplier-invoices/ui";

// The supplier invoices list (specs/supplier-invoices US3) — the URL is the query, the status derived server-side.
export default async function SupplierInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "supplier_invoice" });
  const params = await searchParams;
  const query = parseListQuery(params, {
    columns: SUPPLIER_INVOICE_COLUMN_KEYS,
    defaultSort: SUPPLIER_INVOICE_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listSupplierInvoices(tx, query);
    const strip = await kpis(tx);
    const options = await supplierInvoicePageOptions(tx, auth);
    const prefs = await getUserPreferences(tx, auth);
    // F164: the hero — the year's costs, twelve months, the split by category
    const overview = await supplierOverview(tx, createClock().today());
    const base = (await tenantProfile(tx, auth.tenantId))?.currency ?? CURRENCIES[0];
    return { result, strip, options, prefs, overview, base };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "supplier_invoice");
  const { documents, ...options } = data.options;

  return (
    <ListPage
      ground
      title={t("supplierInvoices.title")}
      meta={t("supplierInvoices.meta.count", { count: data.result.total })}
      actions={canWrite && <NewSupplierInvoiceButton {...options} documents={documents} />}
    >
      <div className="flex flex-col gap-[18px]">
        <SupplierInvoicesHero o={data.overview} k={data.strip} base={data.base} />
        <TableCard>
          <SupplierInvoiceTable
            result={{
              ...data.result,
              rows: data.result.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
            }}
            kpis={data.strip}
            {...options}
            canWrite={canWrite}
            initialSelectedId={typeof params.open === "string" ? params.open : null}
          />
        </TableCard>
      </div>
    </ListPage>
  );
}
