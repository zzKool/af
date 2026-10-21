import { redirect } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { Msg } from "@/kernel/i18n/msg";
import { CompanyProfileForm } from "@/modules/settings/ui";

export default async function CompanySettingsPage() {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });

  const tenantId = auth.tenantId;
  const profile = await withTenantTransaction(prisma, tenantId, async (tx) => {
    return tx.tenant.findUnique({ where: { id: tenantId } });
  });

  if (!profile) redirect("/login");

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-6 text-2xl font-semibold">
        <Msg k="settings.company.heading" />
      </h1>
      <CompanyProfileForm
        initialData={{
          name: profile.name,
          orgNumber: profile.orgNumber ?? "",
          address: profile.address ?? "",
          email: profile.email ?? "",
          website: profile.website ?? "",
          phone: profile.phone ?? "",
          currency: profile.currency,
        }}
      />
    </div>
  );
}
