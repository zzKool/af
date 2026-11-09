// The one on-screen money format (D40), the same in every UI language — client-safe, no Prisma import:
//   −2 312.43 SEK   +237 740.00 SEK   24 000.00 CHF
// thousands = U+202F (narrow no-break space) · decimals = "." · minus = U+2212 · "+" only when asked
// (bank rows, where the sign is the point) · the currency code after, joined by a no-break space.
// Screens only: printed documents keep their language's format (formatCurrency, docs/pdf.md / invoices FR-010).
import { CURRENCY_DECIMAL_PLACES } from "@/kernel/nav/constants";

export const THIN_SPACE = " ";
export const MINUS = "−";
const NBSP = " ";

export interface FormatMoneyOptions {
  /** "+" in front of positive amounts (bank rows); default false */
  signed?: boolean;
  /** omit the currency code (a column whose header names the currency); default false */
  bare?: boolean;
  /** the whole units only, rounded half up (a headline figure — the home's cash, F158); default false */
  whole?: boolean;
}

/** `"159876"` + 1 as a digit string — the rounding of `whole` without a number (no float, any length). */
function incrementDigits(digits: string): string {
  const out = digits.split("");
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i] !== "9") {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
    out[i] = "0";
  }
  return `1${out.join("")}`;
}

/** `formatMoney("-2312.43", "SEK")` → `−2 312.43 SEK`. Takes the decimal string a DTO carries. */
export function formatMoney(
  amount: string,
  currency: string | null | undefined,
  { signed = false, bare = false, whole = false }: FormatMoneyOptions = {},
): string {
  const raw = typeof amount === "string" ? amount.trim() : "";
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m)
    throw new TypeError(`formatMoney: invalid amount "${amount}" — expected a decimal string`);
  const [, sign, intDigits, decDigits = ""] = m;
  if (decDigits.length > CURRENCY_DECIMAL_PLACES && /[1-9]/.test(decDigits.slice(2))) {
    throw new TypeError(
      `formatMoney: amount "${amount}" has more than ${CURRENCY_DECIMAL_PLACES} significant decimals — round before formatting`,
    );
  }
  const dec = decDigits.slice(0, CURRENCY_DECIMAL_PLACES).padEnd(CURRENCY_DECIMAL_PLACES, "0");
  const trimmed = intDigits.replace(/^0+(?=\d)/, "");
  // whole: half up on the magnitude (−0.50 → −1), the decimals dropped
  const int = whole && Number(dec[0]) >= 5 ? incrementDigits(trimmed) : trimmed;
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  const zero = /^0+$/.test(int) && (whole || /^0*$/.test(dec));
  const prefix = sign === "-" && !zero ? MINUS : signed && !zero ? "+" : "";
  const number = whole ? `${prefix}${grouped}` : `${prefix}${grouped}.${dec}`;
  return bare || !currency ? number : `${number}${NBSP}${currency}`;
}
