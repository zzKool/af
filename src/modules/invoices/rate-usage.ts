// Usage hooks other modules ask before deleting what an invoice carries: a contract rate (D24), a VAT
// registration (lesson 19). Wired by the composition root (src/instrumentation.ts) — modules never import each
// other's internals.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { iso } from "./dto";

export async function rateUsageFromInvoiceLines(
  tx: TransactionClient,
  rateId: string,
): Promise<number> {
  return tx.invoiceLine.count({ where: { rateSourceId: rateId } });
}

/** How a contract rate is used: the lines priced on it, and the last day it priced (contracts T024). */
export type RatePricing = {
  /** invoice lines (drafts included) whose unit price came from the rate */
  lines: number;
  /**
   * The latest day those lines were priced on — the line's `period_start`, else its document's, else the
   * document's issue date: the day `contracts.rateFor` is asked for when a draft is filled. `null` when unused.
   */
  lastPeriodStart: string | null;
};

/** The richer usage hook: `rateUsageFromInvoiceLines`'s count plus the last day priced on the rate. */
export async function ratePricingFromInvoiceLines(
  tx: TransactionClient,
  rateId: string,
): Promise<RatePricing> {
  const lines = await tx.invoiceLine.findMany({
    where: { rateSourceId: rateId },
    select: { periodStart: true, invoice: { select: { periodStart: true, issueDate: true } } },
  });
  let last: string | null = null;
  for (const l of lines) {
    const day = iso(l.periodStart ?? l.invoice.periodStart ?? l.invoice.issueDate);
    if (day && (last === null || day > last)) last = day;
  }
  return { lines: lines.length, lastPeriodStart: last };
}

/** Invoices, quotes and credit notes (drafts included) that carry this VAT registration. */
export async function vatRegistrationUsageFromInvoices(
  tx: TransactionClient,
  registrationId: string,
): Promise<number> {
  return tx.invoice.count({ where: { vatRegistrationId: registrationId } });
}
