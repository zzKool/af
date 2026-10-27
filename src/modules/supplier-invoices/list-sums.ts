// The list footer's Σ (F71, the same rule as invoices' `list-sums.ts`). The kit labels every footer sum with one
// currency, so a sum stays only where that label is true: one currency in the filtered set keeps Σ total and
// Σ open in it; several keep only Σ of the base columns (their header names the currency, shown bare), never
// CHF + EUR + SEK added up and labelled SEK.
export type SupplierInvoiceSums = Record<string, string>;

const IN_ROW_CURRENCY = ["amountTotal", "open"] as const;
const IN_BASE_CURRENCY = ["amountBase", "allocatedBase", "fxDifference"] as const;

export function supplierInvoiceListSums(
  rows: readonly { currency: string }[],
  sums: SupplierInvoiceSums | undefined,
): SupplierInvoiceSums | undefined {
  if (!sums) return sums;
  const distinct = new Set(rows.map((r) => r.currency));
  if (distinct.size === 0) return sums;
  const drop: readonly string[] = distinct.size === 1 ? IN_BASE_CURRENCY : IN_ROW_CURRENCY;
  return Object.fromEntries(Object.entries(sums).filter(([col]) => !drop.includes(col)));
}
