import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PartnerList } from "@/components/partners/partner-list";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import * as basService from "@/server/services/bas-preferences";
import * as partnerService from "@/server/services/partners";
import type { CallerIdentity } from "@/types/caller-identity";

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

  const callerIdentity: CallerIdentity = {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role,
    source: "web",
  };

  // Fetch partners and BAS preferences in parallel
  const [partnersResult, basPrefsResult] = await Promise.all([
    withTenantTransaction(prisma, auth.tenantId, async (tx) => {
      return partnerService.getPartners(tx, { includeInactive: true });
    }),
    withTenantTransaction(prisma, auth.tenantId, async (tx) => {
      return basService.getTenantBasPreferences(tx, callerIdentity);
    }),
  ]);

  const partners = partnersResult.data ?? [];
  const basOptions = (basPrefsResult.data ?? []).map((p) => ({
    code: p.basCode,
    label: `${p.basCode} — ${p.basCategory.name}`,
  }));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Partners</h1>
      <PartnerList initialPartners={partners} basOptions={basOptions} />
    </div>
  );
}
