// The one way linking's renderers print an amount: `12'500.00 CHF`, or null when the currency is not one the app
// formats — not read on a receipt (F61-b), or a code outside `CURRENCIES` (an OCR `GBP`). `formatCurrency` throws on
// those, so the renderers skip the amount instead.
import { formatCurrency } from "@/kernel/money/format-currency";
import { CURRENCIES, type Currency } from "@/kernel/nav/constants";

export function moneyText(amount: string | null, currency: string | null): string | null {
  if (!amount || !currency || !(CURRENCIES as readonly string[]).includes(currency)) return null;
  return `${formatCurrency(amount, currency as Currency)} ${currency}`;
}
