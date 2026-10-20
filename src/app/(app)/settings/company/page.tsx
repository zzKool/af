import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { CompanyProfileForm } from "@/modules/settings/components/company-profile-form";

export default async function CompanySettingsPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  // Owner-only access — enforce RBAC server-side (AC #1)
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  if (member?.role !== "owner") redirect("/dashboard");

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
