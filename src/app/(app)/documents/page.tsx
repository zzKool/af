import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DocumentLibraryClient } from "@/components/domain/document-library-client";
import { DocumentUploadZone } from "@/components/domain/document-upload-zone";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentFilters, DocumentSort } from "@/server/actions/documents";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import { createAuditEntry } from "@/server/services/audit";
import { getDocumentTypePrefixesWithSeed } from "@/server/services/document-type-prefixes";
import * as documentService from "@/server/services/documents";
import * as tablePrefsService from "@/server/services/table-preferences";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";

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
  role: "owner" | "accountant";
  caller: CallerIdentity;
}) {
  const { filterOptions, tablePreference } = await withTenantTransaction(
    prisma,
    caller.tenantId,
    async (tx) => {
      const [filterOptsResult, tablePrefResult] = await Promise.all([
        documentService.getDocumentFilterOptions(tx, caller),
        tablePrefsService.getTablePreference(tx, caller, "documents"),
      ]);

      return {
        filterOptions: filterOptsResult.data ?? {
          statuses: [],
          documentTypes: [],
          prefixTypes: [],
        },
        tablePreference: tablePrefResult.data,
      };
    },
  );

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
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  const role: CallerIdentity["role"] = member?.role === "owner" ? "owner" : "accountant";

  const caller: CallerIdentity = {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role,
    source: "web",
  };

  // Load upload zone prefixes (owner only)
  let prefixOptions: { documentType: string; prefix: string }[] = [];
  if (role === "owner") {
    const { prefixes } = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
      const audit: AuditLogger = {
        log: async (params) => {
          await createAuditEntry(tx, caller, params);
        },
      };
      const prefixResult = await getDocumentTypePrefixesWithSeed(tx, caller, audit);
      return { prefixes: prefixResult.data ?? [] };
    });
    prefixOptions = prefixes.map((p) => ({
      documentType: p.documentType,
      prefix: p.prefix,
    }));
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Documents</h1>

      {/* Upload zone — owner only (AC #8) */}
      {role === "owner" && <DocumentUploadZone prefixOptions={prefixOptions} />}

      <div className="mt-8">
        <Suspense fallback={<DocumentsLoading />}>
          <DocumentsContent role={role} caller={caller} />
        </Suspense>
      </div>
    </div>
  );
}
