import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuditEntry } from "@/kernel/audit/audit";
import { getAuthContext } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import * as prefixService from "@/modules/documents";
import { DocumentTypePrefixesTab } from "@/modules/documents/ui";

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
