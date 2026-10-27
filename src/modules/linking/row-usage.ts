// What a bank row has given its allocations (F114, D60) — pure, shared by the service and the read API.
import { Prisma } from "@/generated/prisma/client";

/** What a bank row has given so far (F114): per currency the amounts and bases of its allocating links, and Σ base. */
export type RowUsage = {
  byCurrency: Map<string, { amount: Prisma.Decimal; base: Prisma.Decimal }>;
  base: Prisma.Decimal;
};

/**
 * What is left to allocate from a bank row, in its currency: |amount| − its same-currency allocations − the share
 * its cross-currency links took (their base over the row's base), never negative. Pure.
 */
export function rowRemaining(
  row: {
    amount: string | Prisma.Decimal;
    currency: string;
    amountBase: string | Prisma.Decimal | null;
  },
  usage: RowUsage | undefined,
): Prisma.Decimal {
  const amount = new Prisma.Decimal(row.amount).abs();
  if (!usage) return amount;
  const same = usage.byCurrency.get(row.currency);
  const otherBase = usage.base.minus(same?.base ?? 0);
  let left = amount.minus(same?.amount ?? 0);
  if (otherBase.gt(0) && row.amountBase != null) {
    const base = new Prisma.Decimal(row.amountBase).abs();
    if (base.gt(0))
      left = left.minus(
        otherBase.mul(amount).div(base).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      );
  }
  return left.lt(0) ? new Prisma.Decimal(0) : left;
}
