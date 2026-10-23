import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import { getUserPreferences } from "@/modules/settings";
import {
  kpis,
  listSupplierInvoices,
  SUPPLIER_INVOICE_COLUMN_KEYS,
  SUPPLIER_INVOICE_DEFAULT_SORT,
  supplierInvoicePageOptions,
} from "@/modules/supplier-invoices";
import { NewSupplierInvoiceButton, SupplierInvoiceTable } from "@/modules/supplier-invoices/ui";

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
    const [result, strip, options, prefs] = await Promise.all([
      listSupplierInvoices(tx, query),
      kpis(tx),
      supplierInvoicePageOptions(tx, auth),
      getUserPreferences(tx, auth),
    ]);
    return { result, strip, options, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "supplier_invoice");
  const { documents, ...options } = data.options;

  return (
    <ListPage
      title={t("supplierInvoices.title")}
      meta={t("supplierInvoices.meta.count", { count: data.result.total })}
      actions={canWrite && <NewSupplierInvoiceButton {...options} documents={documents} />}
    >
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
    </ListPage>
  );
}
