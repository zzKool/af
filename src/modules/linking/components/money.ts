// The one way linking's renderers print an amount on screen — the kernel's `formatMoney` (D40): `12 500.00 CHF`,
// `−45.90 SEK`. Null when there is nothing to print: no amount, or no currency read (a receipt, F61-b) — never a
// guessed currency. A code outside the app's own list (an OCR `GBP`) prints as read.
import { formatMoney } from "@/kernel/money/format-money";

export function moneyText(
  amount: string | null,
  currency: string | null,
  options: { signed?: boolean } = {},
): string | null {
  if (!amount || !currency) return null;
  try {
    return formatMoney(amount, currency, options);
  } catch {
    return null; // not a decimal string (an OCR read gone wrong) — print nothing rather than throw in a render
  }
}
