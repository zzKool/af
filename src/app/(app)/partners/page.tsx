import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import * as partnerService from "@/modules/partners";
import { PartnerList } from "@/modules/partners/ui";

export default async function PartnersPage() {
  const auth = await requireCaller({ action: "manage", subject: "partner" });

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
