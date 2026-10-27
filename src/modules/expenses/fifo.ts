// Settlement arithmetic (FR-007, FR-008, D26) — pure, property-tested in fifo.pure.test.ts. Decimal strings in and out.
//   fifoAllocate: the oldest open private expenses first (expense date, then key), min(open, remaining) each,
//                 stopping when the refund is used up — the residual stays open ("leave some in the company").
// The difference between what the row gave and the claim is the kernel's `fxDifference` (F114): derived, signed,
// rounding within the one tolerance — nothing to confirm here any more.
import { Prisma } from "@/generated/prisma/browser";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export type OpenExpense = {
  expenseId: string;
  key: string;
  date: string;
  description: string;
  amountBase: string;
  openBase: string;
};

export type FifoLine = OpenExpense & { allocatedBase: string; remainingOpen: string };

const money = (d: Dec): string => d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);

/** FIFO order: expense date, then key (`Ex213-Rep-01` after `Ex213-Tr-02` on the same date is fine — stable and visible). */
export function fifoOrder<T extends { date: string; key: string }>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export function fifoAllocate(open: readonly OpenExpense[], refundBase: Dec | string): FifoLine[] {
  let remaining = new D(refundBase).abs();
  const lines: FifoLine[] = [];
  for (const e of fifoOrder(open)) {
    if (remaining.lte(0)) break;
    const openBase = new D(e.openBase);
    if (openBase.lte(0)) continue;
    const take = D.min(openBase, remaining);
    remaining = remaining.minus(take);
    lines.push({ ...e, allocatedBase: money(take), remainingOpen: money(openBase.minus(take)) });
  }
  return lines;
}

/** Σ of what the lines leave open on their expenses. */
export function residualOpen(lines: readonly FifoLine[]): string {
  return money(lines.reduce<Dec>((acc, l) => acc.plus(new D(l.remainingOpen)), new D(0)));
}
