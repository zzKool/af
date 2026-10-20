/**
 * Number formatting utility for NON-MONETARY values only.
 * CRITICAL: Do NOT use for currency amounts — use formatCurrency() from format-currency.ts.
 * Currency formatting follows the currency's convention, not the user's locale.
 */

import { resolveLocale } from "@/kernel/i18n/format-date";

/**
 * Format a number for display using the user's locale preference.
 * For quantities, percentages, generic numbers — NOT for money.
 */
export function formatNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  const resolved = resolveLocale(locale);
  return new Intl.NumberFormat(resolved, options).format(value);
}
