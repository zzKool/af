import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { categoryOptions, partnerOptions } from "@/modules/journal";
import { inboxRows, unlinkedDocuments } from "@/modules/linking";
import { InboxWorkbench } from "@/modules/linking/ui";
import { getUserPreferences } from "@/modules/settings";

// The inbox (specs/linking US3): the rows needing attention with their candidates, the keyboard, bulk apply,
// the unlinked documents. Computed on request — one candidate pool per type, scored in one pass.
export default async function InboxPage() {
  const auth = await requireCaller({ action: "read", subject: "bank_transaction" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [rows, documents, categories, partners, prefs] = await Promise.all([
      inboxRows(tx),
      unlinkedDocuments(tx),
      categoryOptions(tx, auth),
      partnerOptions(tx),
      getUserPreferences(tx, auth),
    ]);
    return { rows, documents, categories, partners, prefs };
  });
  const t = translator(data.prefs.data?.locale ?? null);
  const high = data.rows.filter((r) => r.top?.confidence === "HIGH").length;

  return (
    <ListPage
      title={t("linking.inbox.title")}
      meta={t("linking.inbox.meta", {
        count: data.rows.length,
        high,
        documents: data.documents.length,
      })}
      back={<Link href="/banking">← {t("banking.title")}</Link>}
    >
      <InboxWorkbench
        rows={data.rows}
        documents={data.documents}
        categories={data.categories}
        partners={data.partners}
        canWrite={can(auth, "create", "bank_transaction")}
      />
    </ListPage>
  );
}
