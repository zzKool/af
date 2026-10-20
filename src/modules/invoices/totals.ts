// Invoice arithmetic — pure, Decimal end to end, strings in and out (specs/invoices FR-003; harvest §4).
// Per line: gross = quantity × unit price; discount = percent of gross OR a fixed amount (never more than gross);
// net = gross − discount; line VAT = net × rate (informational). Per document: subtotal = Σ line net;
// header discount = percent of subtotal; net = subtotal − discount; VAT computed ONCE PER RATE on the summed
// base (scaled by the header discount), rows with 0 VAT dropped, ascending by rate; total = net + Σ VAT.
// Rounding: half-up to 2 decimals when a figure is stored or printed, never earlier.
// Client-safe: imports Decimal from the browser bundle so the sheet can show live totals.
import { Prisma } from "@/generated/prisma/browser";
import type { VatByRate } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export type LineInput = {
  quantity: string;
  unitPrice: string;
  vatRate: string;
  /** percent of the gross, 0–100 */
  discountPercent?: string | null;
  /** a fixed amount instead of a percent (ignored when discountPercent is given) */
  discountFixed?: string | null;
};

export type LineTotals = {
  gross: string;
  discountAmount: string;
  net: string;
  vatAmount: string;
  total: string;
};

export type InvoiceTotals = {
  lines: LineTotals[];
  subtotal: string;
  discountAmount: string;
  net: string;
  vatByRate: VatByRate[];
  vat: string;
  total: string;
};

export class TotalsError extends Error {
  constructor(
    public readonly code:
      | "NEGATIVE_QUANTITY"
      | "NEGATIVE_PRICE"
      | "BAD_PERCENT"
      | "BAD_VAT_RATE"
      | "DISCOUNT_EXCEEDS_LINE"
      | "BAD_AMOUNT",
    message: string,
    public readonly lineIndex?: number,
  ) {
    super(message);
    this.name = "TotalsError";
  }
}

const money = (d: Dec): string => d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const r2 = (d: Dec): Dec => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

function dec(value: string | null | undefined, what: string, lineIndex?: number): Dec {
  if (value === null || value === undefined || value.trim() === "") return new D(0);
  try {
    const d = new D(value.trim());
    if (!d.isFinite()) throw new Error("not finite");
    return d;
  } catch {
    throw new TotalsError("BAD_AMOUNT", `${what} is not a number: "${value}"`, lineIndex);
  }
}

export function lineTotals(line: LineInput, index = 0): LineTotals {
  const quantity = dec(line.quantity, "quantity", index);
  const unitPrice = dec(line.unitPrice, "unit price", index);
  const vatRate = dec(line.vatRate, "VAT rate", index);
  if (quantity.isNegative())
    throw new TotalsError("NEGATIVE_QUANTITY", "Quantity cannot be negative", index);
  if (unitPrice.isNegative())
    throw new TotalsError("NEGATIVE_PRICE", "Unit price cannot be negative", index);
  if (vatRate.isNegative() || vatRate.gt(100))
    throw new TotalsError("BAD_VAT_RATE", "VAT rate must be between 0 and 100", index);

  const gross = r2(quantity.mul(unitPrice));
  let discount = new D(0);
  if (line.discountPercent != null && line.discountPercent !== "") {
    const pct = dec(line.discountPercent, "discount percent", index);
    if (pct.isNegative() || pct.gt(100))
      throw new TotalsError("BAD_PERCENT", "Discount percent must be between 0 and 100", index);
    discount = r2(gross.mul(pct).div(100));
  } else if (line.discountFixed != null && line.discountFixed !== "") {
    discount = r2(dec(line.discountFixed, "discount", index));
    if (discount.isNegative())
      throw new TotalsError("BAD_AMOUNT", "Discount cannot be negative", index);
  }
  if (discount.gt(gross))
    throw new TotalsError("DISCOUNT_EXCEEDS_LINE", "Line discount exceeds the line amount", index);
  const net = gross.sub(discount);
  const vat = r2(net.mul(vatRate).div(100));
  return {
    gross: money(gross),
    discountAmount: money(discount),
    net: money(net),
    vatAmount: money(vat),
    total: money(net.add(vat)),
  };
}

/** Totals of a whole document. `headerDiscountPercent` is the only header-level discount (percent, 0–100). */
export function invoiceTotals(
  lines: readonly LineInput[],
  headerDiscountPercent?: string | null,
): InvoiceTotals {
  const computed = lines.map((l, i) => lineTotals(l, i));
  const subtotal = computed.reduce((s, l) => s.add(new D(l.net)), new D(0));

  let discountAmount = new D(0);
  if (headerDiscountPercent != null && headerDiscountPercent !== "") {
    const pct = dec(headerDiscountPercent, "discount percent");
    if (pct.isNegative() || pct.gt(100))
      throw new TotalsError("BAD_PERCENT", "Discount percent must be between 0 and 100");
    discountAmount = r2(subtotal.mul(pct).div(100));
  }
  const net = subtotal.sub(discountAmount);
  const ratio = subtotal.isZero() ? new D(1) : net.div(subtotal);

  // base per rate = Σ line net at that rate, scaled by the header discount; VAT once per rate on that base
  const bases = new Map<string, Dec>();
  lines.forEach((l, i) => {
    const rate = dec(l.vatRate, "VAT rate", i).toDecimalPlaces(2).toString();
    bases.set(rate, (bases.get(rate) ?? new D(0)).add(new D(computed[i].net)));
  });
  const vatByRate: VatByRate[] = [...bases.entries()]
    .map(([rate, base]) => {
      const scaledBase = r2(base.mul(ratio));
      return { rate, base: money(scaledBase), vat: money(scaledBase.mul(new D(rate)).div(100)) };
    })
    .filter((row) => new D(row.rate).gt(0) && new D(row.vat).gt(0))
    .sort((a, b) => new D(a.rate).cmp(new D(b.rate)));
  const vat = vatByRate.reduce((s, r) => s.add(new D(r.vat)), new D(0));

  return {
    lines: computed,
    subtotal: money(subtotal),
    discountAmount: money(discountAmount),
    net: money(net),
    vatByRate,
    vat: money(vat),
    total: money(net.add(vat)),
  };
}

/** `8.1` → "8.1", `25` → "25", `2.60` → "2.6" — the printed VAT percent. */
export function formatVatPercent(rate: string): string {
  const d = new D(rate);
  return d.isInteger() ? d.toFixed(0) : d.toDecimalPlaces(1, D.ROUND_HALF_UP).toString();
}
