// A currency code read from data (a partner's default, a stored row) parsed into the app's `Currency`, never cast
// (lessons audit 30): a code outside `CURRENCIES` is null, and the caller decides what null means.
import { CURRENCIES, type Currency } from "@/kernel/nav/constants";

export function parseCurrency(value: string | null | undefined): Currency | null {
  return (CURRENCIES as readonly string[]).includes(value ?? "") ? (value as Currency) : null;
}
