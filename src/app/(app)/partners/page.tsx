import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { PartnerList } from "@/modules/partners/components/partner-list";
import * as partnerService from "@/modules/partners/partners";

export default async function PartnersPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  // Owner-only page — check role
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  const role: CallerIdentity["role"] = member?.role === "owner" ? "owner" : "accountant";
  if (role !== "owner") redirect("/dashboard");

  const partnersResult = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    return partnerService.getPartners(tx, { includeInactive: true });
  });

  const partners = partnersResult.data ?? [];

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Partners</h1>
      <PartnerList initialPartners={partners} />
    </div>
  );
}
