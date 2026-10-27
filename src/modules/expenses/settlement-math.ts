// Settlement arithmetic on the links (F114, D60) — pure, client-safe (the settle page runs the same figures the
// server confirms): the amount a base slice refunds, the base the books carried for it, the totals of a settlement
// (Σ base, the claim, the signed difference, rounding within the one tolerance, what the row keeps) and which BAS
// account the sign points at.
import { Prisma } from "@/generated/prisma/browser";
import { settlementTolerance } from "@/kernel/money/settlement";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** The sign of the difference says which account the accountant books it on: > 0 a loss (7960), < 0 a gain (3960). */
export function differenceBasCode(difference: Dec | string, rounding: boolean): string | null {
  const d = new D(difference);
  if (d.isZero() || rounding) return null;
  return d.gt(0) ? "7960" : "3960";
}

/**
 * The settlement's derived money from its lines and its row (F114): Σ base, the claim they settle in base, the
 * signed difference, whether it is rounding, what the row keeps unallocated.
 */
export function settlementTotals(
  lines: readonly { allocatedBase: string; expectedBase: string }[],
  refundBase: Dec | string,
): {
  allocatedBase: Dec;
  expectedBase: Dec;
  differenceBase: Dec;
  rounding: boolean;
  unallocatedBase: Dec;
} {
  const allocatedBase = lines.reduce((acc, l) => acc.plus(l.allocatedBase), new D(0));
  const expectedBase = lines.reduce((acc, l) => acc.plus(l.expectedBase), new D(0));
  const differenceBase = allocatedBase.minus(expectedBase);
  const rounding =
    !differenceBase.isZero() && differenceBase.abs().lte(settlementTolerance(expectedBase));
  const unallocated = new D(refundBase).abs().minus(allocatedBase);
  return {
    allocatedBase,
    expectedBase,
    differenceBase,
    rounding,
    unallocatedBase: unallocated.lt(0) ? new D(0) : unallocated,
  };
}

/** The amount a base slice refunds of an open claim: the share, or the whole open amount when the base covers it. */
export function amountForBase(
  e: { openAmount: string; openBase: string },
  allocatedBase: Dec | string,
): Dec {
  const openAmount = new D(e.openAmount);
  const open = new D(e.openBase);
  const base = new D(allocatedBase);
  if (open.lte(0) || base.gte(open.minus(settlementTolerance(open)))) return openAmount;
  const share = openAmount.mul(base).div(open).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return D.min(openAmount, share);
}

/**
 * The base the books carry for what a line refunds of an open claim (the kernel's `expectedBases` rule, applied to
 * what is still open): the whole open claim when the amount covers it within the tolerance; else the open claim pro
 * rata — and the base given itself when it is within the tolerance of that (a same-currency refund settles
 * exactly what it gives; the pro-rata cent is not a difference).
 */
export function expectedBaseFor(
  e: { openAmount: string; openBase: string },
  allocatedAmount: Dec | string,
  allocatedBase?: Dec | string,
): Dec {
  const openAmount = new D(e.openAmount);
  const open = new D(e.openBase);
  const amount = new D(allocatedAmount);
  if (openAmount.isZero() || amount.gte(openAmount.minus(settlementTolerance(openAmount))))
    return open;
  const derived = open.mul(amount).div(openAmount).toDecimalPlaces(2, D.ROUND_HALF_UP);
  if (allocatedBase !== undefined) {
    const given = new D(allocatedBase);
    if (given.minus(derived).abs().lte(settlementTolerance(derived))) return given;
  }
  return derived;
}
