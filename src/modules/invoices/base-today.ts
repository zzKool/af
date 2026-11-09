// F169, the board *Invoice studio*: "≈ 30 128 SEK today" beside the total of an invoice in a foreign currency. Display
// only — a draft shows an estimate at today's ECB rate; an issued document shows the base written once at issue and
// never this estimate (D37: the base is never recomputed). Pure, Decimal, client-safe.
import { Prisma } from "@/generated/prisma/browser";

const D = Prisma.Decimal;

export type BaseFigure = {
  amount: string;
  currency: string;
  /** true: the draft's total at today's rate; false: the base stored at issue */
  estimate: boolean;
};

export function baseFigure(
  inv: { status: string; currency: string; baseCurrency: string; totalBase: string | null },
  total: string | null,
  todayRate: string | null,
): BaseFigure | null {
  if (inv.currency === inv.baseCurrency) return null;
  if (inv.status !== "draft")
    return inv.totalBase
      ? { amount: inv.totalBase, currency: inv.baseCurrency, estimate: false }
      : null;
  if (!total || !todayRate) return null;
  const amount = new D(total).mul(new D(todayRate)).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
  return { amount, currency: inv.baseCurrency, estimate: true };
}
