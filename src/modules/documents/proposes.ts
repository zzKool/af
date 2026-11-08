// D78 — drop anything: what a document nobody typed reads like, from its reading alone. A paper with an invoice
// number or a VAT number is a supplier invoice; a till receipt (a merchant, no vendor) is an expense; no amount
// read at all → the inbox asks what it is (a contract, an NDA, a certificate… or a receipt the reading missed).
// Pure, client-safe; the banking row's own rule (`proposeKind`, D75) also weighs the row — this one has none.
import type { InboxFacts } from "./queries";

export type ReadingProposal = "expense" | "supplier_invoice" | "ask";

/** The kinds the *What is it?* question offers (the upload kinds the owner can type a document as). */
export const ASK_KINDS = ["expense", "invoice", "contract", "nda", "certificate"] as const;

export function readingProposes(facts: InboxFacts): ReadingProposal {
  const total = facts.invoiceTotal;
  if (total === undefined || total === null || Number.isNaN(Number(total))) return "ask";
  if (facts.invoiceNumber || facts.vendorTaxId) return "supplier_invoice";
  if (facts.merchantName && !facts.vendorName) return "expense";
  return "supplier_invoice";
}
