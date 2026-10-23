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
