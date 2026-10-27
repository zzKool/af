// Settlement tolerance (D25, open question B8) and what is still open — pure, shared by every module that derives
// a paid / settled state from its allocations (linking, invoices, supplier invoices, expenses, banking, package). A target counts as settled when what is still open is at most max(0.05, 0.5 % of the amount):
// foreign bank fees on CHF receipts are 10–30 CHF on 25 000, under 0.5 %. The difference is booked as bank
// fees by the banking module when the owner accepts the short payment.
import { Prisma } from "@/generated/prisma/browser";

type Dec = InstanceType<typeof Prisma.Decimal>;

export function settlementTolerance(amount: Dec | string): Dec {
  const half = new Prisma.Decimal(amount)
    .abs()
    .mul("0.005")
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return Prisma.Decimal.max(new Prisma.Decimal("0.05"), half);
}

/** True when the allocations cover the amount within the settlement tolerance. */
export function isSettled(amount: Dec | string, allocations: readonly (Dec | string)[]): boolean {
  const sum = allocations.reduce<Dec>(
    (acc, a) => acc.plus(new Prisma.Decimal(a)),
    new Prisma.Decimal(0),
  );
  return new Prisma.Decimal(amount).minus(sum).lte(settlementTolerance(amount));
}

/**
 * What is still open on a target: `total − allocated − credited`, floored at 0 (an overpayment leaves nothing
 * open, never a negative). `credited` is what credit notes already took off an invoice; 0 elsewhere.
 */
export function openAmount(
  total: Dec | string,
  allocated: Dec | string,
  credited: Dec | string = "0",
): Dec {
  const open = new Prisma.Decimal(total).minus(new Prisma.Decimal(allocated)).minus(credited);
  return open.isNegative() ? new Prisma.Decimal(0) : open;
}

// --- the link as the payment record (F114, D60) ---

/** One allocating link onto an entity: what part of the entity it pays (its currency) and the base the row gave. */
export type Allocation = { amount: Dec | string; base: Dec | string };

/** The share of an entity's amount its allocations cover, 0 … 1 (an overpayment counts as 1). */
export function paidShare(amount: Dec | string, allocated: Dec | string): Dec {
  const total = new Prisma.Decimal(amount).abs();
  if (total.isZero()) return new Prisma.Decimal(1);
  const share = new Prisma.Decimal(allocated).abs().div(total);
  return share.gt(1) ? new Prisma.Decimal(1) : share;
}

export type FxDifference = {
  /** Σ allocated amounts, the entity's currency */
  allocated: Dec;
  /** Σ what the rows gave, in base */
  allocatedBase: Dec;
  /** the entity's base × the paid share — what the books carry for the part that is paid */
  expectedBase: Dec;
  /** `allocatedBase − expectedBase`, signed: on a payable or a reimbursement > 0 is a loss (7960), < 0 a gain (3960); on a receivable the reverse */
  difference: Dec;
  /** |difference| within the tolerance of the expected base — rounding, not a gain or a loss */
  rounding: boolean;
};

/**
 * The FX difference of an entity from its links: what the rows gave in base against the base the entity carries
 * for the paid share (FR-003). Pure; nothing of it is stored.
 */
export function fxDifference(
  amount: Dec | string,
  amountBase: Dec | string,
  allocations: readonly Allocation[],
): FxDifference {
  const zero = new Prisma.Decimal(0);
  const allocated = allocations.reduce((acc, a) => acc.plus(new Prisma.Decimal(a.amount)), zero);
  const allocatedBase = allocations.reduce((acc, a) => acc.plus(new Prisma.Decimal(a.base)), zero);
  const expectedBase = new Prisma.Decimal(amountBase)
    .abs()
    .mul(paidShare(amount, allocated))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const difference = allocatedBase.minus(expectedBase);
  return {
    allocated,
    allocatedBase,
    expectedBase,
    difference,
    rounding: !difference.isZero() && difference.abs().lte(settlementTolerance(expectedBase)),
  };
}

/**
 * The base a same-currency allocation takes from its row: the row's base pro rata of the amount, 2 dp — and the
 * exact remainder when the allocation exhausts the row, so Σ base of a fully used row equals its base to the cent.
 */
export function sliceBase(
  row: { amount: Dec | string; amountBase: Dec | string },
  alreadyAllocated: { amount: Dec | string; base: Dec | string },
  amount: Dec | string,
): Dec {
  const rowAmount = new Prisma.Decimal(row.amount).abs();
  const rowBase = new Prisma.Decimal(row.amountBase).abs();
  const slice = new Prisma.Decimal(amount);
  const after = new Prisma.Decimal(alreadyAllocated.amount).plus(slice);
  if (after.gte(rowAmount)) return rowBase.minus(alreadyAllocated.base);
  if (rowAmount.isZero()) return new Prisma.Decimal(0);
  return rowBase.mul(slice).div(rowAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
