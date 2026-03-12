import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { VatRegistrationsTab } from "@/components/settings/vat-registrations-tab";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";

export default async function VatRegistrationsSettingsPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  // Owner-only access — enforce RBAC server-side
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  if (member?.role !== "owner") redirect("/dashboard");

  const tenantId = auth.tenantId;

  // Fetch initial VAT registrations within tenant transaction
  const registrations = await withTenantTransaction(prisma, tenantId, async (tx) => {
    const regs = await tx.vatRegistration.findMany({
      orderBy: [{ country: "asc" }, { vatNumber: "asc" }],
    });
    return regs.map((r) => ({
      id: r.id,
      country: r.country,
      vatNumber: r.vatNumber,
      rateSchedule: r.rateSchedule as { rates: number[] } | null,
    }));
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">VAT Registrations</h1>
      <VatRegistrationsTab initialRegistrations={registrations} />
    </div>
  );
}
