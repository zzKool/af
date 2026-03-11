// Currency formatting utility — client-safe (NO @prisma/client import)
import { CURRENCY_DECIMAL_PLACES, type Currency } from "./constants";

/**
 * Format a numeric string for display using currency-specific conventions.
 * Accepts string input (the format received from Server Action serialization).
 * Returns number-only string — no currency code prefix.
 *
 * Conventions are CURRENCY-driven, not locale-driven:
 * - SEK: non-breaking space thousands, comma decimal → "12\u00A0500,00"
 * - CHF: apostrophe thousands, period decimal → "12'500.00"
 * - EUR: comma thousands, period decimal → "12,500.00"
 * - USD: comma thousands, period decimal → "12,500.00"
 */
export function formatCurrency(amount: string, currency: Currency): string {
  if (amount === "" || amount == null) {
    throw new TypeError(`formatCurrency: invalid amount "${amount}" — expected a numeric string`);
  }

  // Parse sign
  let value = amount.trim();
  let negative = false;
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  }

  // Validate numeric
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new TypeError(`formatCurrency: invalid amount "${amount}" — expected a numeric string`);
  }

  // Split integer and decimal parts
  const dotIndex = value.indexOf(".");
  let intPart: string;
  let decPart: string;

  if (dotIndex === -1) {
    intPart = value;
    decPart = "";
  } else {
    intPart = value.slice(0, dotIndex);
    decPart = value.slice(dotIndex + 1);
  }

  // Pad or truncate decimal to CURRENCY_DECIMAL_PLACES
  decPart = decPart.padEnd(CURRENCY_DECIMAL_PLACES, "0").slice(0, CURRENCY_DECIMAL_PLACES);

  // Add thousands separators
  const { thousandsSep, decimalSep } = getSeparators(currency);
  const formattedInt = addThousandsSeparator(intPart, thousandsSep);

  const formatted = `${formattedInt}${decimalSep}${decPart}`;
  return negative ? `-${formatted}` : formatted;
}

function getSeparators(currency: Currency): {
  thousandsSep: string;
  decimalSep: string;
} {
  switch (currency) {
    case "SEK":
      return { thousandsSep: "\u00A0", decimalSep: "," };
    case "CHF":
      return { thousandsSep: "'", decimalSep: "." };
    case "EUR":
    case "USD":
      return { thousandsSep: ",", decimalSep: "." };
  }
}

function addThousandsSeparator(intPart: string, separator: string): string {
  const chars = intPart.split("");
  const result: string[] = [];
  for (let i = chars.length - 1, count = 0; i >= 0; i--, count++) {
    if (count > 0 && count % 3 === 0) {
      result.unshift(separator);
    }
    result.unshift(chars[i]);
  }
  return result.join("");
}
