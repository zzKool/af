import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { Kpi, KpiRow, PulseSection, StackBar, TableCard } from "@/kernel/ui/pulse";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  DOCUMENT_COLUMN_KEYS,
  DOCUMENT_DEFAULT_SORT,
  getDocumentStats,
  getUploadKinds,
  inboxTotals,
  listDocuments,
} from "@/modules/documents";
import { DocumentsTable } from "@/modules/documents/ui";
import { UPLOAD_KIND_PREFIX } from "@/modules/numbering";
import { getUserPreferences } from "@/modules/settings";

// The document library (D19, D20): every document in one table — the URL is the query, the server loads one page,
// the table changes the URL. The accountant sees financial documents only (the read model applies can()); the
// owner uploads and deletes. Since F153 the sidebar's *Documents* opens the desk (/documents: drop, then decide);
// this is its *All documents*.
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "financial_document" });
  const query = parseListQuery(await searchParams, {
    columns: DOCUMENT_COLUMN_KEYS,
    defaultSort: DOCUMENT_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listDocuments(tx, auth, query);
    const stats = await getDocumentStats(tx, auth);
    const inbox = await inboxTotals(tx, auth);
    const prefs = await getUserPreferences(tx, auth);
    return { result, stats: stats.data ?? null, inbox, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canUpload = can(auth, "create", "financial_document");
  // The upload form offers the fixed document kinds (D6: no prefix settings).
  const prefixOptions = canUpload
    ? getUploadKinds().map((kind) => ({ documentType: kind, prefix: UPLOAD_KIND_PREFIX[kind] }))
    : [];

  return (
    <ListPage
      ground
      title={t("documents.library.title")}
      meta={t("documents.meta", {
        total: data.stats?.totalCount ?? data.result.total,
        unreviewed: data.inbox.total,
        failed: data.stats?.byStatus?.ocr_failed ?? 0,
      })}
      actions={
        // a secondary: the page's one primary is *Upload document* in the upload zone (owner)
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/documents" data-testid="documents-inbox-link" />}
        >
          {t("documents.inbox.libraryLink", { count: data.inbox.total })}
        </Button>
      }
    >
      <div className="flex flex-col gap-[18px]">
        <KpiRow testId="library-hero">
          <Kpi
            label={t("documents.pulse.total")}
            value={data.stats?.totalCount ?? data.result.total}
            sub={t("documents.pulse.totalSub")}
          />
          <Kpi
            label={t("documents.pulse.review")}
            value={data.inbox.total}
            tone={data.inbox.total > 0 ? "attention" : "done"}
            sub={t("documents.pulse.reviewSub")}
            href="/documents"
          />
          <Kpi
            label={t("documents.pulse.duplicates")}
            value={data.inbox.duplicates}
            tone={data.inbox.duplicates > 0 ? "danger" : "neutral"}
            sub={t("documents.pulse.duplicatesSub")}
          />
          <Kpi
            label={t("documents.pulse.failed")}
            value={data.stats?.byStatus?.ocr_failed ?? 0}
            tone={(data.stats?.byStatus?.ocr_failed ?? 0) > 0 ? "danger" : "neutral"}
            sub={t("documents.pulse.failedSub")}
          />
        </KpiRow>
        {data.stats && Object.keys(data.stats.byStatus).length > 0 && (
          <PulseSection title={t("documents.pulse.splitTitle")} sub={t("documents.pulse.splitSub")}>
            <StackBar
              testId="library-split"
              parts={Object.entries(data.stats.byStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, n]) => ({
                  key: status,
                  label: status.replaceAll("_", " "),
                  value: n,
                  detail: n,
                }))}
            />
          </PulseSection>
        )}
        <TableCard>
          <DocumentsTable
            result={{
              ...data.result,
              rows: data.result.rows.map((d) => ({
                ...d,
                createdAt: d.createdAt.toISOString(),
                reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
              })),
            }}
            canUpload={canUpload}
            canDelete={can(auth, "delete", "financial_document")}
            prefixOptions={prefixOptions}
          />
        </TableCard>
      </div>
    </ListPage>
  );
}
