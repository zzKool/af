import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { listInbox, toInboxData } from "@/modules/documents";
import type { MakeItOptions } from "@/modules/documents/ui";
import { InboxWorkbench } from "@/modules/documents/ui";
import { expensePageOptions } from "@/modules/expenses";
import { getUserPreferences } from "@/modules/settings";
import { supplierInvoicePageOptions } from "@/modules/supplier-invoices";

// The document inbox (specs/documents US4): every document that still needs a decision, the work page shaped
// like /banking/inbox. Computed on request; the owner also gets the two creation dialogs' option lists so
// `e` / `i` open *Make it…* pre-filled. The accountant reads (financial documents only).
export default async function DocumentInboxPage() {
  const auth = await requireCaller({ action: "read", subject: "financial_document" });
  const canWrite = can(auth, "update", "financial_document");
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [inbox, prefs] = await Promise.all([listInbox(tx, auth), getUserPreferences(tx, auth)]);
    let options: MakeItOptions | null = null;
    if (canWrite) {
      const [expense, supplier] = await Promise.all([
        expensePageOptions(tx, auth, { documents: false, transactions: false }),
        supplierInvoicePageOptions(tx, auth, { documents: false }),
      ]);
      options = {
        expense: {
          groups: expense.groups,
          categories: expense.categories,
          sources: expense.sources,
        },
        supplier: {
          groups: supplier.groups,
          categories: supplier.categories,
          suppliers: supplier.suppliers,
          registrations: supplier.registrations,
        },
      };
    }
    return { inbox: toInboxData(inbox), options, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));

  return (
    <ListPage
      title={t("documents.inbox.title")}
      meta={t("documents.inbox.meta", { count: data.inbox.counts.total })}
      back={<Link href="/documents">← {t("documents.title")}</Link>}
    >
      <InboxWorkbench initial={data.inbox} canWrite={canWrite} options={data.options} />
    </ListPage>
  );
}
