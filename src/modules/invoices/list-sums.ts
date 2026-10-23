// The list footer's Σ (F71). The kit labels every footer sum with one currency, so a sum is shown only where
// that label is true: one document currency in the filtered set → Σ total and Σ remaining in it; documents in
// several currencies → only Σ total in the base currency (its header names the currency), never CHF + EUR + SEK
// added up and labelled with the first row's code.
export type InvoiceSums = Record<string, string>;

const IN_DOCUMENT_CURRENCY = ["totalAmount", "remaining"] as const;
const IN_BASE_CURRENCY = ["totalBase"] as const;

export function invoiceListSums(
  currencies: readonly string[],
  sums: InvoiceSums | undefined,
): InvoiceSums | undefined {
  if (!sums) return sums;
  const distinct = new Set(currencies);
  if (distinct.size === 0) return sums;
  const drop: readonly string[] = distinct.size === 1 ? IN_BASE_CURRENCY : IN_DOCUMENT_CURRENCY;
  return Object.fromEntries(Object.entries(sums).filter(([col]) => !drop.includes(col)));
}
