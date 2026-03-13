import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ContractList } from "@/components/partners/contract-list";
import { PartnerForm } from "@/components/partners/partner-form";
import { Separator } from "@/components/ui/separator";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import * as basService from "@/server/services/bas-preferences";
import * as contractService from "@/server/services/contracts";
import * as partnerService from "@/server/services/partners";
import * as vatService from "@/server/services/vat-registrations";
import type { CallerIdentity } from "@/types/caller-identity";

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

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

  const { partnerResult, basPrefsResult, contractsResult, vatResult, employeesResult } =
    await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
      const [partner, basPrefs, contracts, vat, employees] = await Promise.all([
        partnerService.getPartner(tx, id),
        basService.getTenantBasPreferences(tx, callerIdentity),
        contractService.getContracts(tx, id, { includeInactive: true }),
        vatService.getVatRegistrations(tx, callerIdentity),
        partnerService.getPartners(tx, { types: ["employee"] }),
      ]);
      return {
        partnerResult: partner,
        basPrefsResult: basPrefs,
        contractsResult: contracts,
        vatResult: vat,
        employeesResult: employees,
      };
    });

  if (partnerResult.error || !partnerResult.data) {
    notFound();
  }

  const basOptions = (basPrefsResult.data ?? []).map((p) => ({
    code: p.basCode,
    label: `${p.basCode} — ${p.basCategory.name}`,
  }));

  // Serialize the partner data for client component
  const partner = {
    ...partnerResult.data,
    createdAt: partnerResult.data.createdAt.toISOString(),
    updatedAt: partnerResult.data.updatedAt.toISOString(),
  };

  const isClient = partner.types.includes("client");

  // Serialize contracts for client component (Decimal → string, Date → string)
  const contracts = (contractsResult.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    startDate: c.startDate.toISOString().split("T")[0],
    endDate: c.endDate ? c.endDate.toISOString().split("T")[0] : null,
    assignedEmployeeId: c.assignedEmployeeId,
    billingRate: c.billingRate ? c.billingRate.toString() : null,
    currency: c.currency,
    paymentTerms: c.paymentTerms,
    vatRegistrationId: c.vatRegistrationId,
    externalReferences: (c.externalReferences as { label: string; value: string }[]) ?? [],
    isActive: c.isActive,
  }));

  const vatRegistrations = (vatResult.data ?? []).map((v) => ({
    id: v.id,
    label: `${v.country} — ${v.vatNumber}`,
  }));

  const employeePartners = (employeesResult.data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
  }));

  return (
    <div className="mx-auto max-w-3xl p-6">
      <PartnerForm partner={partner} basOptions={basOptions} />
      {isClient && (
        <>
          <Separator className="my-6" />
          <ContractList
            partnerId={partner.id}
            contracts={contracts}
            vatRegistrations={vatRegistrations}
            employeePartners={employeePartners}
            defaultCurrency={partner.defaultCurrency}
          />
        </>
      )}
    </div>
  );
}
