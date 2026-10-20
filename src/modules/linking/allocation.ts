// Pure allocation arithmetic — property-tested in allocation.test.ts. Decimal in, Decimal out; no I/O.
import { Prisma } from "@/generated/prisma/client";

type Decimal = Prisma.Decimal;

export function sumAllocations(allocations: readonly (Decimal | string)[]): Decimal {
  return allocations.reduce<Decimal>(
    (acc, a) => acc.plus(new Prisma.Decimal(a)),
    new Prisma.Decimal(0),
  );
}

export function remaining(
  amount: Decimal | string,
  allocations: readonly (Decimal | string)[],
): Decimal {
  return new Prisma.Decimal(amount).minus(sumAllocations(allocations));
}

/** True when `candidate` fits into what is left of `amount` after `allocations` (never over-allocates). */
export function canAllocate(
  amount: Decimal | string,
  allocations: readonly (Decimal | string)[],
  candidate: Decimal | string,
): boolean {
  const c = new Prisma.Decimal(candidate);
  if (c.lte(0)) return false;
  return remaining(amount, allocations).gte(c);
}
