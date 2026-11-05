// The facts `checkProof` needs that only the server knows (F131, review 2026-10-31 §4): the ECB rate of the booking
// date (`rates.rateToBase`), D53's verdict on *billed to* (documents' `checkBilledTo` against the company profile),
// the partners the active rules name for the counterparty key (D74, `banking.rulesForKey`), the counterparty memory
// (`memoryForRow`), the row this document already justifies, and whether the supplier holds the invoice number
// already (D35). One read for the dialog; the comparison itself stays pure in `check-proof.ts`. Server-only.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { getLinksFor } from "./linking";
import { memoryForRow } from "./memory";
import type { ProofFacts } from "./types";

export type { ProofFacts };

export type ProofFactsInput = {
  transactionId: string;
  /** the uploaded proof; absent for a receipt lost */
  documentId?: string | null;
  /** the reading's currency as the dialog holds it (edited or read); the rate is looked up when it differs from the row's */
  readingCurrency?: string | null;
  /** the supplier's invoice number as typed — D35 is checked for the picked partner */
  invoiceNumber?: string | null;
  /** the partner picked or matched; null before any pick */
  partnerId?: string | null;
  /** who the paper is addressed to, as read (D53) */
  customerName?: string | null;
  customerTaxId?: string | null;
};

/** The facts for one proof on one row — the dialog calls it when the document, the currency, the partner or the number changes. */
export async function proofFacts(
  tx: TransactionClient,
  caller: CallerIdentity,
  input: ProofFactsInput,
): Promise<ProofFacts | null> {
  const row = await banking.getBankTransaction(tx, input.transactionId);
  if (!row) return null;

  const readingCurrency = input.readingCurrency?.toUpperCase() ?? null;
  let fxRate: string | null = null;
  let fxRateDate: string | null = null;
  if (readingCurrency && readingCurrency !== row.currency) {
    const r = await rates.rateToBase(tx, row.bookingDate, readingCurrency, row.currency);
    if (r) {
      fxRate = r.rate.toString();
      fxRateDate = r.rateDate;
    }
  }

  const profile = await settings.getTenantProfile(tx, caller);
  const registrations = await settings.getVatRegistrations(tx, caller);
  const companyName = profile.data?.name ?? "";
  let billedToFits: boolean | null = null;
  if (profile.data) {
    const verdict = documents.checkBilledTo(
      {
        name: profile.data.name,
        orgNumber: profile.data.orgNumber,
        vatNumbers: (registrations.data ?? []).map((v) => v.vatNumber),
      },
      { customerName: input.customerName, customerTaxId: input.customerTaxId },
    );
    billedToFits = verdict === "unknown" ? null : verdict === "match";
  }

  const rules = await banking.rulesForKey(tx, row.counterpartyKey);
  const rulePartnerIds = [...new Set(rules.flatMap((r) => (r.partnerId ? [r.partnerId] : [])))];
  const memory = await memoryForRow(tx, input.transactionId);

  // the document is a proof already when a row justifies it directly, or justifies the entity it became
  let documentJustifiesOther: { rowDate: string } | null = null;
  if (input.documentId) {
    const links = (await getLinksFor(tx, { type: "document", id: input.documentId })).data ?? [];
    const origin = links.find((l) => l.kind === "created_from");
    const onEntity = origin ? ((await getLinksFor(tx, origin.from)).data ?? []) : [];
    const other = [...links, ...onEntity].find(
      (l) =>
        l.kind === "justifies" &&
        l.from.type === "bank_transaction" &&
        l.from.id !== input.transactionId,
    );
    if (other) {
      const otherRow = await banking.getBankTransaction(tx, other.from.id);
      documentJustifiesOther = {
        rowDate: otherRow?.bookingDate ?? other.createdAt.toISOString().slice(0, 10),
      };
    }
  }

  let supplierNumberTaken = false;
  if (input.partnerId && input.invoiceNumber?.trim()) {
    const twins = await supplierInvoices.findSupplierInvoiceDuplicates(tx, {
      partnerId: input.partnerId,
      invoiceNumber: input.invoiceNumber,
    });
    supplierNumberTaken = twins.some((m) => m.kind === "exact");
  }

  return {
    fxRate,
    fxRateDate,
    billedToFits,
    companyName,
    rulePartnerIds,
    memory,
    documentJustifiesOther,
    supplierNumberTaken,
  };
}
