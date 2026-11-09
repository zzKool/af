// The currency card of the work surface (the board *Banking*'s *Currency conversion*): a foreign-currency row's
// original amount, its base at the ECB rate (the row's `rate`, D3), and — when the row is the foreign leg of a
// transfer pair (D44) — what the bank charged and the cost of its rate against the ECB's. Derived for the screen,
// never stored. Pure.
import { Prisma } from "@/generated/prisma/browser";
import { BASE_CURRENCY } from "@/kernel/nav/constants";

const D = Prisma.Decimal;

export type FxCard = {
  original: { amount: string; currency: string };
  ecb: { rate: string; amount: string };
  bank: { rate: string; amount: string; cost: string; percent: string } | null;
};

export function fxCard(row: {
  amount: string;
  currency: string;
  amountBase: string;
  rate: string;
  bankImplicitRate: string | null;
}): FxCard | null {
  if (row.currency === BASE_CURRENCY) return null;
  const foreign = new D(row.amount).abs();
  const ecbAmount = new D(row.amountBase).abs();
  const card: FxCard = {
    original: { amount: foreign.toFixed(2), currency: row.currency },
    ecb: { rate: row.rate, amount: ecbAmount.toFixed(2) },
    bank: null,
  };
  if (!row.bankImplicitRate || foreign.isZero()) return card;
  const bankAmount = foreign.mul(row.bankImplicitRate).toDecimalPlaces(2, D.ROUND_HALF_UP);
  // money out costs more at a worse rate; money in brings less — the cost is what the owner lost either way
  const out = new D(row.amount).isNegative();
  const cost = out ? bankAmount.minus(ecbAmount) : ecbAmount.minus(bankAmount);
  card.bank = {
    rate: row.bankImplicitRate,
    amount: bankAmount.toFixed(2),
    cost: cost.toFixed(2),
    percent: ecbAmount.isZero() ? "0.0" : cost.div(ecbAmount).mul(100).toFixed(1),
  };
  return card;
}
