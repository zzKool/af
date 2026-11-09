import { redirect } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { Msg } from "@/kernel/i18n/msg";
import { CompanyProfileForm, SettingsSection } from "@/modules/settings/ui";

export default async function CompanySettingsPage() {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });

  const tenantId = auth.tenantId;
  const profile = await withTenantTransaction(prisma, tenantId, async (tx) => {
    return tx.tenant.findUnique({ where: { id: tenantId } });
  });

  if (!profile) redirect("/login");

  return (
    <SettingsSection title={<Msg k="settings.company.heading" />}>
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
        initialLogo={profile.logoUrl}
      />
    </SettingsSection>
  );
}
