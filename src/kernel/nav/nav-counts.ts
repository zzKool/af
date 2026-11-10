// The rail's counts of open work (F72), keyed by nav path — client-safe, pure. The app layout reads one cheap
// count per owning module (through its index.ts) and hands them here; the keys are NAV_ITEMS paths, so a move of
// a nav item (F137: Work from /banking/inbox to /work) is caught by the test instead of silently dropping a badge.

/** open work per nav path (`/banking` → rows to justify, …); absent or 0 = no badge */
export type NavCounts = Partial<Record<string, number>>;

/** what the app layout reads for the owner — every number derived on request, nothing stored */
export type OpenWork = {
  /** banking `rowsToJustifyCount`: the main accounts' rows still without their proof */
  rowsToJustify: number;
  /** documents `inboxOpenCount`: the inbox's pending + ready */
  documentsToReview: number;
  /** invoices `overdueInvoiceCount` */
  overdueInvoices: number;
  /** supplier invoices `overdueSupplierInvoiceCount` */
  overdueSupplierInvoices: number;
  /** rates `rateGaps`: the ECB days without a rate in any pair, each once (F136) */
  rateGapDays: number;
};

/** The rail's numbers. **Work** carries the one count (F97 US4, specs/justify FR-007): the rows to justify plus
 *  the documents to review — the monthly loop's open items in one number; Banking and Documents keep their own. */
export function navCounts(open: OpenWork): NavCounts {
  return {
    "/work": open.rowsToJustify + open.documentsToReview,
    "/banking": open.rowsToJustify,
    "/documents": open.documentsToReview,
    "/invoices": open.overdueInvoices,
    "/supplier-invoices": open.overdueSupplierInvoices,
    "/rates": open.rateGapDays,
  };
}
