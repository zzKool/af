import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DocumentTypePrefixesTab } from "@/components/settings/document-type-prefixes-tab";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import { createAuditEntry } from "@/server/services/audit";
import * as prefixService from "@/server/services/document-type-prefixes";

export default async function DocumentPrefixesSettingsPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  // Owner-only access — enforce RBAC server-side
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  if (member?.role !== "owner") redirect("/dashboard");

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
