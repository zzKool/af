import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { getDocumentStats, listInbox, toInboxData } from "@/modules/documents";
import type { MakeItOptions } from "@/modules/documents/ui";
import { DropHero, InboxWorkbench } from "@/modules/documents/ui";
import { expensePageOptions } from "@/modules/expenses";
import { documentBasHints } from "@/modules/linking";
import { getUserPreferences } from "@/modules/settings";
import { supplierInvoicePageOptions } from "@/modules/supplier-invoices";

// The documents desk (F153, the board *Documents*; specs/documents US4, D78): drop anything on top — the app reads
// it and proposes what it becomes —, then the inbox in three columns: what waits for a decision, the document with
// the boxes of what was read, and *What it read* with the actions. Every document is one click away (*All
// documents*, /documents/library). The owner also gets the creation dialogs' option lists so *Make it…* opens
// pre-filled. The accountant reads (financial documents only).
export default async function DocumentsDeskPage() {
  const auth = await requireCaller({ action: "read", subject: "financial_document" });
  const canWrite = can(auth, "update", "financial_document");
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const inbox = await listInbox(tx, auth);
    const stats = await getDocumentStats(tx, auth);
    const prefs = await getUserPreferences(tx, auth);
    let options: MakeItOptions | null = null;
    if (canWrite) {
      const expense = await expensePageOptions(tx, auth, { documents: false, transactions: false });
      const supplier = await supplierInvoicePageOptions(tx, auth, { documents: false });
      options = {
        expense: {
          groups: expense.groups,
          categories: expense.categories,
          sources: expense.sources,
          basHistory: expense.basHistory,
        },
        supplier: {
          groups: supplier.groups,
          categories: supplier.categories,
          suppliers: supplier.suppliers,
          registrations: supplier.registrations,
          basHistory: supplier.basHistory,
        },
        basProposals: await documentBasHints(
          tx,
          inbox.rows.map((r) => r.id),
        ),
      };
    }
    return {
      inbox: toInboxData(inbox),
      total: stats.data?.totalCount ?? 0,
      options,
      prefs,
    };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canUpload = can(auth, "create", "financial_document");

  return (
    <ListPage
      ground
      title={t("documents.title")}
      meta={t("documents.desk.meta", { count: data.inbox.counts.total })}
      actions={
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/documents/library" data-testid="documents-library-link" />}
        >
          {t("documents.desk.all", { count: data.total })}
        </Button>
      }
    >
      {canUpload && <DropHero />}
      <InboxWorkbench initial={data.inbox} canWrite={canWrite} options={data.options} />
    </ListPage>
  );
}
