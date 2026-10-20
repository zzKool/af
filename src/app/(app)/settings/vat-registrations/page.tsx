import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { VatRegistrationsTab } from "@/modules/settings/ui";

export default async function VatRegistrationsSettingsPage() {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });

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
    <div className="p-4 md:p-6">
      <h1 className="mb-6 text-2xl font-semibold">VAT Registrations</h1>
      <VatRegistrationsTab initialRegistrations={registrations} />
    </div>
  );
}
