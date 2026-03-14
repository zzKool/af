import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FileUploadZone } from "@/components/domain/file-upload-zone";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import { createAuditEntry } from "@/server/services/audit";
import { getDocumentTypePrefixesWithSeed } from "@/server/services/document-type-prefixes";
import * as documentService from "@/server/services/documents";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";

const STATUS_COLORS: Record<string, string> = {
  uploaded: "bg-muted text-muted-foreground",
  processing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  extracted: "bg-muted text-muted-foreground",
  ocr_failed: "bg-destructive/10 text-destructive",
  linked: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export default async function DocumentsPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  const role: CallerIdentity["role"] = member?.role === "owner" ? "owner" : "accountant";
  if (role !== "owner") redirect("/dashboard");

  const caller: CallerIdentity = {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role,
    source: "web",
  };

  const { prefixes, recentDocs } = await withTenantTransaction(
    prisma,
    auth.tenantId,
    async (tx) => {
      const audit: AuditLogger = {
        log: async (params) => {
          await createAuditEntry(tx, caller, params);
        },
      };

      const prefixResult = await getDocumentTypePrefixesWithSeed(tx, caller, audit);
      const docsResult = await documentService.getRecentDocuments(tx, 5);

      return {
        prefixes: prefixResult.data ?? [],
        recentDocs: docsResult.data ?? [],
      };
    },
  );

  const prefixOptions = prefixes.map((p) => ({
    documentType: p.documentType,
    prefix: p.prefix,
  }));

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Documents</h1>

      <FileUploadZone prefixOptions={prefixOptions} />

      {recentDocs.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-medium">Recent uploads</h2>
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Business Key</th>
                  <th className="px-3 py-2 text-left font-medium">File Name</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {recentDocs.map((doc) => (
                  <tr key={doc.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{doc.businessKey}</td>
                    <td className="px-3 py-2 truncate max-w-48">{doc.fileName}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[doc.status] ?? "bg-muted text-muted-foreground"}`}
                      >
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
