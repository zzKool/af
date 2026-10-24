// What a page needs to render one document: the invoice with its derived state, the parties (the stored
// snapshot once issued, otherwise resolved live from partner + tenant + bank account), the VAT treatment and
// the related number. One transaction, used by the entity page and the print route.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { getInvoice, nextNumberHint } from "./queries";
import type { InvoiceWithDerived, PrintedParties } from "./types";
import { type Registration, type VatTreatment, vatTreatmentFor } from "./vat-treatment";

export type SheetContext = {
  invoice: InvoiceWithDerived;
  parties: PrintedParties;
  treatment: VatTreatment;
  relatedNumber: string | null;
  numberHint: string | null;
  registrations: Registration[];
  partnerShortCode: string | null;
};

export async function resolveSheetContext(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string,
  today?: string,
): Promise<SheetContext | null> {
  const res = await getInvoice(tx, id, today ?? new Date().toISOString().slice(0, 10));
  if (!res.data) return null;
  const invoice = res.data;
  const partner = await partners.getPartner(tx, invoice.partnerId);
  const profile = await settings.getTenantProfile(tx, caller);
  const regs = await settings.getVatRegistrations(tx, caller);
  const accounts = await banking.getBankAccounts(tx, caller);
  const related = invoice.relatedInvoiceId
    ? await tx.invoice.findUnique({
        where: { id: invoice.relatedInvoiceId },
        select: { number: true },
      })
    : null;
  const registration = regs.data?.find((r) => r.id === invoice.vatRegistrationId) ?? null;
  const treatment = vatTreatmentFor(registration, {
    address: partner.data?.address ?? null,
    vatNumber: partner.data?.vatNumber ?? null,
  }).treatment;
  const bank =
    accounts.data?.find((a) => a.currency === invoice.currency) ??
    accounts.data?.find((a) => a.currency === invoice.baseCurrency) ??
    null;
  const parties: PrintedParties = invoice.printedParties ?? {
    tenant: {
      name: profile.data?.name ?? "",
      orgNumber: profile.data?.orgNumber ?? null,
      address: profile.data?.address ?? null,
      email: profile.data?.email ?? null,
      website: profile.data?.website ?? null,
      logoUrl: profile.data?.logoUrl ?? null,
      vatNumber: registration?.vatNumber ?? null,
      vatCountry: registration?.country ?? null,
    },
    partner: {
      name: partner.data?.name ?? "",
      address: partner.data?.address ?? null,
      vatNumber: partner.data?.vatNumber ?? null,
      orgNumber: partner.data?.orgNumber ?? null,
      email: partner.data?.email ?? null,
    },
    bank: bank
      ? {
          bankName: bank.bankFormat.bankName,
          accountHolder: profile.data?.name ?? null,
          iban: bank.iban,
          bic: bank.bic,
          accountNumber: bank.accountNumber,
          currency: bank.currency,
        }
      : null,
  };
  const numberHint =
    invoice.status === "draft"
      ? await nextNumberHint(tx, invoice.type, partner.data?.shortCode ?? null, invoice.issueDate)
      : null;
  return {
    invoice,
    parties,
    treatment,
    relatedNumber: related?.number ?? null,
    numberHint,
    registrations: (regs.data ?? []).map((r) => ({
      id: r.id,
      country: r.country,
      vatNumber: r.vatNumber,
      rateSchedule: r.rateSchedule,
    })),
    partnerShortCode: partner.data?.shortCode ?? null,
  };
}
