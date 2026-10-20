import { redirect } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { CompanyProfileForm } from "@/modules/settings/ui";

export default async function CompanySettingsPage() {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });

  const tenantId = auth.tenantId;
  const profile = await withTenantTransaction(prisma, tenantId, async (tx) => {
    return tx.tenant.findUnique({ where: { id: tenantId } });
  });

  if (!profile) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Company Profile</h1>
      <CompanyProfileForm
        initialData={{
          name: profile.name,
          orgNumber: profile.orgNumber ?? "",
          address: profile.address ?? "",
          currency: profile.currency,
        }}
      />
    </div>
  );
}
