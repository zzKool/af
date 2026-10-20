import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  DOCUMENT_COLUMN_KEYS,
  DOCUMENT_DEFAULT_SORT,
  getDocumentStats,
  getUploadKinds,
  listDocuments,
} from "@/modules/documents";
import { DocumentsTable } from "@/modules/documents/ui";
import { UPLOAD_KIND_PREFIX } from "@/modules/numbering";
import { getUserPreferences } from "@/modules/settings";

// The document library (D19, D20): the URL is the query, the server loads one page, the table changes the
// URL. The accountant sees financial documents only (the read model applies can()); the owner uploads and deletes.
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
    const [result, stats, prefs] = await Promise.all([
      listDocuments(tx, auth, query),
      getDocumentStats(tx, auth),
      getUserPreferences(tx, auth),
    ]);
    return { result, stats: stats.data ?? null, prefs };
  });
  const t = translator(data.prefs.data?.locale ?? null);
  const canUpload = can(auth, "create", "financial_document");
  // The upload form offers the fixed document kinds (D6: no prefix settings).
  const prefixOptions = canUpload
    ? getUploadKinds().map((kind) => ({ documentType: kind, prefix: UPLOAD_KIND_PREFIX[kind] }))
    : [];

  return (
    <ListPage
      title={t("documents.title")}
      meta={t("documents.meta", {
        total: data.stats?.totalCount ?? data.result.total,
        unreviewed: data.stats?.unreviewed ?? 0,
        failed: data.stats?.byStatus?.ocr_failed ?? 0,
      })}
    >
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
    </ListPage>
  );
}
