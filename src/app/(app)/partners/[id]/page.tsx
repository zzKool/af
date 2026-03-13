import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PartnerForm } from "@/components/partners/partner-form";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import * as basService from "@/server/services/bas-preferences";
import * as partnerService from "@/server/services/partners";
import type { CallerIdentity } from "@/types/caller-identity";

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  const role: CallerIdentity["role"] = member?.role === "owner" ? "owner" : "accountant";
  if (role !== "owner") redirect("/dashboard");

  const callerIdentity: CallerIdentity = {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role,
    source: "web",
  };

  const [partnerResult, basPrefsResult] = await Promise.all([
    withTenantTransaction(prisma, auth.tenantId, async (tx) => {
      return partnerService.getPartner(tx, id);
    }),
    withTenantTransaction(prisma, auth.tenantId, async (tx) => {
      return basService.getTenantBasPreferences(tx, callerIdentity);
    }),
  ]);

  if (partnerResult.error || !partnerResult.data) {
    notFound();
  }

  const basOptions = (basPrefsResult.data ?? []).map((p) => ({
    code: p.basCode,
    label: `${p.basCode} — ${p.basCategory.name}`,
  }));

  // Serialize the partner data for client component
  const partner = {
    ...partnerResult.data,
    createdAt: partnerResult.data.createdAt.toISOString(),
    updatedAt: partnerResult.data.updatedAt.toISOString(),
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <PartnerForm partner={partner} basOptions={basOptions} />
    </div>
  );
}
