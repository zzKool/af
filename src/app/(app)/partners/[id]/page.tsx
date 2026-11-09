import { notFound } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { EntityPage } from "@/kernel/ui/shell/page";
import { listTransactions, TRANSACTION_DEFAULT_SORT } from "@/modules/banking";
import * as contractService from "@/modules/contracts";
import { documentsByIds } from "@/modules/documents";
import { expensesForPartner } from "@/modules/expenses";
import { partnerInsight } from "@/modules/invoices";
import { PartnerFigures, PartnerMonths, PartnerTimeline } from "@/modules/invoices/ui";
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
    contactsResult,
    documents,
    transactions,
    expenses,
    insight,
  } = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const partner = await partnerService.getPartner(tx, id);
    const basPrefs = { data: await settingsService.basPickerOptions(tx) };
    const contracts = await contractService.getContracts(tx, id, { includeInactive: true, today });
    const vat = await settingsService.getVatRegistrations(tx, callerIdentity);
    const employees = await partnerService.getPartners(tx, { types: ["employee"] });
    const contacts = await partnerService.listPartnerContacts(tx, id);
    // the rate history of every contract, one query (D24) — the contract rows carry it to the client
    const rates = await contractService.listContractRatesFor(
      tx,
      (contracts.data ?? []).map((c) => c.id),
      today,
    );
    // the relationships (specs/linking, "relationship navigation"): the documents linked to the partner and
    // the bank rows that name it (F113) — read models of other modules, composed here
    const links = await linksTouching(tx, "partner", [id]);
    const documentIds = links.flatMap((l) =>
      [l.from, l.to].filter((e) => e.type === "document").map((e) => e.id),
    );
    const documents = await documentsByIds(tx, [...new Set(documentIds)]);
    const transactions = await listTransactions(tx, {
      page: 1,
      pageSize: 25,
      sort: TRANSACTION_DEFAULT_SORT,
      filters: { partnerId: { kind: "in", values: [id] } },
    });
    // spend with this partner (F87): its expenses, newest first, and Σ base
    const expenses = await expensesForPartner(tx, id);
    // the invoicing (F144, the board *Partner*): derived from the client's invoices and the rows that pay them
    const insight = await partnerInsight(tx, id, today);
    return {
      insight,
      partnerResult: partner,
      basPrefsResult: basPrefs,
      contractsResult: contracts,
      ratesByContract: rates,
      vatResult: vat,
      employeesResult: employees,
      contactsResult: contacts,
      documents,
      transactions,
      expenses,
    };
  });

  if (partnerResult.error || !partnerResult.data) {
    notFound();
  }

  // the BAS picker's options (F125): settings' one builder
  const basOptions = basPrefsResult.data;

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

  const contacts = (contactsResult.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
  }));

  const active = contracts.find((c) => c.isActive && c.currentRate);
  const rate =
    active?.currentRate && active.currency
      ? { amount: active.currentRate.rate, currency: active.currency }
      : null;
  const invoices = insight.invoiceCount > 0 || partner.types.includes("client");

  return (
    <EntityPage ground>
      <PartnerDetailTabs
        partner={partner}
        contracts={contracts}
        contacts={contacts}
        vatRegistrations={vatRegistrations}
        employeePartners={employeePartners}
        basOptions={basOptions}
        defaultCurrency={partner.defaultCurrency}
        documents={documents}
        transactions={{
          total: transactions.total,
          rows: transactions.rows.map((r) => ({
            id: r.id,
            bookingDate: r.bookingDate,
            description: r.description,
            amount: r.amount,
            currency: r.currency,
            amountBase: r.amountBase,
            basLabel: r.basLabel,
          })),
        }}
        expenses={expenses}
        figures={invoices ? <PartnerFigures insight={insight} rate={rate} /> : undefined}
        activity={
          invoices ? (
            <>
              <PartnerMonths insight={insight} />
              <PartnerTimeline insight={insight} />
            </>
          ) : undefined
        }
        invoiceCount={invoices ? insight.invoiceCount : undefined}
        year={today.slice(0, 4)}
      />
    </EntityPage>
  );
}
