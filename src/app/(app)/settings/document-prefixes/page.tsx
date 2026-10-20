import { createAuditEntry } from "@/kernel/audit/audit";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import * as prefixService from "@/modules/documents";
import { DocumentTypePrefixesTab } from "@/modules/documents/ui";

export default async function DocumentPrefixesSettingsPage() {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });

  const tenantId = auth.tenantId;
  const callerIdentity = {
    userId: auth.userId,
    tenantId,
    role: "owner" as const,
    source: "web" as const,
  };

  const prefixes = await withTenantTransaction(prisma, tenantId, async (tx) => {
    const audit = {
      log: async (params: Parameters<typeof createAuditEntry>[2]) =>
        createAuditEntry(tx, callerIdentity, params),
    };
    const result = await prefixService.getDocumentTypePrefixesWithSeed(tx, callerIdentity, audit);
    return (result.data ?? []).map((p) => ({
      id: p.id,
      documentType: p.documentType,
      prefix: p.prefix,
    }));
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Document Prefixes</h1>
      <DocumentTypePrefixesTab initialPrefixes={prefixes} />
    </div>
  );
}
