// The invoice studio's server facts (F143, Pulse phase 7; the board *Invoice studio*): what *Ready to send?* cannot
// see in the draft — the client's short code, the bank account on the page, whether the ECB rate of the issue day
// is there — and the client's payment history for *When will it be paid?*. Read only.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as rates from "@/modules/rates";
import { clientPaymentHistory, type PaidInvoice } from "./payment-history";
import type { SheetContext } from "./sheet-context";

export type StudioFacts = {
  partnerShortCode: string | null;
  bank: { currency: string; iban: string | null } | null;
  /** the ECB rate of the issue day is stored (or the invoice is in the base) */
  rateKnown: boolean;
  /** F169: today's ECB rate to the base (≈ base today beside the total), null in the base or without a rate */
  todayRate?: string | null;
  /** F146: what the company block and the footer miss (Settings → Company) */
  companyMissing?: ("email" | "website")[];
  history: PaidInvoice[];
};

export async function studioFacts(
  tx: TransactionClient,
  ctx: SheetContext,
  today: string,
): Promise<StudioFacts> {
  const inv = ctx.invoice;
  const foreign = inv.currency !== inv.baseCurrency;
  const rate =
    !foreign ||
    (await rates.rateToBase(tx, inv.issueDate, inv.currency, inv.baseCurrency)) !== null;
  const todayRate = foreign
    ? ((await rates.rateToBase(tx, today, inv.currency, inv.baseCurrency))?.rate.toString() ?? null)
    : null;
  return {
    partnerShortCode: ctx.partnerShortCode,
    bank: ctx.parties.bank
      ? { currency: ctx.parties.bank.currency, iban: ctx.parties.bank.iban ?? null }
      : null,
    rateKnown: rate,
    todayRate,
    companyMissing: (["email", "website"] as const).filter((k) => !ctx.parties.tenant[k]),
    history: await clientPaymentHistory(tx, inv.partnerId, today),
  };
}
