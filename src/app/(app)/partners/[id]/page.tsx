import { notFound } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { EntityPage } from "@/kernel/ui/shell/page";
import * as contractService from "@/modules/contracts";
import { documentsByIds } from "@/modules/documents";
import { JOURNAL_DEFAULT_SORT, listJournalEntries } from "@/modules/journal";
import { linksTouching } from "@/modules/linking";
import * as partnerService from "@/modules/partners";
import { PartnerDetailTabs } from "@/modules/partners/ui";
import * as settingsService from "@/modules/settings";

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const callerIdentity = await requireCaller({ action: "manage", subject: "partner" });
  const auth = callerIdentity;
  const today = createClock().today();

  const {
    partnerResult,
    basPrefsResult,
    contractsResult,
    ratesByContract,
    vatResult,
    employeesResult,
    documents,
    journal,
  } = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [partner, basPrefs, contracts, vat, employees] = await Promise.all([
      partnerService.getPartner(tx, id),
      settingsService.getTenantBasPreferences(tx, callerIdentity),
      contractService.getContracts(tx, id, { includeInactive: true, today }),
      settingsService.getVatRegistrations(tx, callerIdentity),
      partnerService.getPartners(tx, { types: ["employee"] }),
    ]);
    // the rate history of every contract, one query (D24) — the contract rows carry it to the client
    const rates = await contractService.listContractRatesFor(
      tx,
      (contracts.data ?? []).map((c) => c.id),
      today,
    );
    // the relationships (specs/linking, "relationship navigation"): the documents linked to the partner and
    // the journal entries that name it — read models of other modules, composed here
    const links = await linksTouching(tx, "partner", [id]);
    const documentIds = links.flatMap((l) =>
      [l.from, l.to].filter((e) => e.type === "document").map((e) => e.id),
    );
    const [documents, journal] = await Promise.all([
      documentsByIds(tx, [...new Set(documentIds)]),
      listJournalEntries(tx, {
        page: 1,
        pageSize: 25,
        sort: JOURNAL_DEFAULT_SORT,
        filters: { partnerId: { kind: "in", values: [id] } },
      }),
    ]);
    return {
      partnerResult: partner,
      basPrefsResult: basPrefs,
      contractsResult: contracts,
      ratesByContract: rates,
      vatResult: vat,
      employeesResult: employees,
      documents,
      journal,
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

  // Serialize contracts for client component (Decimal → string, Date → string)
  const contracts = (contractsResult.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    startDate: c.startDate.toISOString().split("T")[0],
    endDate: c.endDate ? c.endDate.toISOString().split("T")[0] : null,
    assignedEmployeeId: c.assignedEmployeeId,
    currentRate: c.currentRate,
    rates: (ratesByContract[c.id] ?? []).map((r) => ({
      id: r.id,
      validFrom: r.validFrom,
      validTo: r.validTo,
      rate: r.rate,
      unit: r.unit,
      note: r.note,
      state: r.state,
    })),
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
    <EntityPage>
      <PartnerDetailTabs
        partner={partner}
        contracts={contracts}
        vatRegistrations={vatRegistrations}
        employeePartners={employeePartners}
        basOptions={basOptions}
        defaultCurrency={partner.defaultCurrency}
        documents={documents}
        journal={{
          total: journal.total,
          rows: journal.rows.map((r) => ({
            id: r.id,
            entryDate: r.entryDate,
            description: r.description,
            amount: r.amount,
            currency: r.currency,
            amountBase: r.amountBase,
            basLabel: r.basLabel,
          })),
        }}
      />
    </EntityPage>
  );
}
