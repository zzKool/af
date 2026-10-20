import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireCaller } from "@/kernel/auth/caller";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { ListPage } from "@/kernel/ui/shell/page";
import type { DocumentFilters, DocumentSort } from "@/modules/documents";
import * as documentService from "@/modules/documents";
import { DocumentLibraryClient, DocumentUploadZone } from "@/modules/documents/ui";
import { UPLOAD_KIND_PREFIX } from "@/modules/numbering";
import * as tablePrefsService from "@/modules/settings";

function DocumentsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

async function DocumentsContent({
  role,
  caller,
}: {
  role: CallerIdentity["role"];
  caller: CallerIdentity;
}) {
  // table_preferences is user-scoped (no RLS) — fetch outside tenant transaction (AD3)
  const [filterOptsResult, tablePrefResult] = await Promise.all([
    withTenantTransaction(prisma, caller.tenantId, (tx) =>
      documentService.getDocumentFilterOptions(tx, caller),
    ),
    tablePrefsService.getTablePreference(prisma, caller, "documents"),
  ]);

  const filterOptions = filterOptsResult.data ?? {
    statuses: [],
    documentTypes: [],
    prefixTypes: [],
  };
  const tablePreference = tablePrefResult.data;

  // Parse stored preferences
  let initialPreferences: {
    filters?: DocumentFilters;
    sort?: DocumentSort;
    pageSize?: number;
  } | null = null;

  if (tablePreference?.preferences) {
    const prefs = tablePreference.preferences as Record<string, unknown>;
    initialPreferences = {
      filters: prefs.filters as DocumentFilters | undefined,
      sort: prefs.sort as DocumentSort | undefined,
      pageSize: typeof prefs.pageSize === "number" ? prefs.pageSize : undefined,
    };
  }

  return (
    <DocumentLibraryClient
      filterOptions={filterOptions}
      initialPreferences={initialPreferences}
      role={role}
    />
  );
}

export default async function DocumentsPage() {
  const caller = await requireCaller();
  const role = caller.role;
  const canUpload = can(caller, "create", "financial_document");

  // The upload form offers the fixed document kinds (D6: no prefix settings).
  const prefixOptions = canUpload
    ? documentService
        .getUploadKinds()
        .map((kind) => ({ documentType: kind, prefix: UPLOAD_KIND_PREFIX[kind] }))
    : [];

  return (
    <ListPage title="Documents">
      {/* Upload zone — owner only (AC #8) */}
      {canUpload && <DocumentUploadZone prefixOptions={prefixOptions} />}

      <div className="mt-6">
        <Suspense fallback={<DocumentsLoading />}>
          <DocumentsContent role={role} caller={caller} />
        </Suspense>
      </div>
    </ListPage>
  );
}
