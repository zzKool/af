import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { Msg } from "@/kernel/i18n/msg";
import { SettingsSection, VatRegistrationsTab } from "@/modules/settings/ui";

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
    <SettingsSection title={<Msg k="settings.vat.title" />}>
      <VatRegistrationsTab initialRegistrations={registrations} />
    </SettingsSection>
  );
}
