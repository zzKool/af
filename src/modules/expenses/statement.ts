// The reimbursement statement (US4-7, FR-009): what the print route renders and the job stores — the settlement,
// its lines with their expenses, the refund row, the company, the totals and the residual left open.
// MUST NOT import from next/* or src/components/*.
import { Prisma } from "@/generated/prisma/browser";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as settings from "@/modules/settings";
import { fifoOrder } from "./fifo";
import { groupLabel } from "./groups";
import { allocatedByExpense, isStatementSuperseded } from "./settlements";
import { owedBase } from "./status";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export type StatementLine = {
  key: string;
  date: string;
  description: string;
  group: string;
  basCode: string;
  amount: string;
  currency: string;
  amountBase: string;
  allocatedBase: string;
  remainingOpen: string;
  note: string | null;
};

export type StatementData = {
  number: string;
  status: "active" | "cancelled";
  statementSuperseded: boolean;
  company: { name: string; orgNumber: string | null; address: string | null };
  payee: string;
  refund: { bookingDate: string; amount: string; currency: string; base: string; account: string };
  lines: StatementLine[];
  totals: {
    allocatedBase: string;
    exchangeDifferenceBase: string;
    roundingBase: string;
    exchangeDifferenceBasCode: string | null;
    residualOpen: string;
  };
  note: string | null;
  createdAt: Date;
};

export async function resolveStatement(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string,
): Promise<StatementData | null> {
  const s = await tx.settlement.findUnique({
    where: { id },
    include: {
      paymentSource: true,
      lines: { include: { expense: { include: { group: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!s) return null;
  const [profile, t] = await Promise.all([
    settings.getTenantProfile(tx, caller),
    banking.getBankTransaction(tx, s.bankTransactionId),
  ]);
  // what each expense still owes AFTER this settlement, over every active settlement (this one included) —
  // `owedBase`, the list's and the ledger's rule: a remainder under the tolerance prints 0.00 (F88, D47)
  const allocated = await allocatedByExpense(
    tx,
    s.lines.map((l) => l.expenseId),
  );
  const lines: StatementLine[] = fifoOrder(
    s.lines.map((l) => ({
      key: l.expense.key,
      date: l.expense.date.toISOString().slice(0, 10),
      description: l.expense.description,
      group: groupLabel(l.expense.group),
      basCode: l.expense.basCode,
      amount: l.expense.amount.toFixed(2),
      currency: l.expense.currency,
      amountBase: l.expense.amountBase.toFixed(2),
      allocatedBase: l.allocatedBase.toFixed(2),
      remainingOpen: owedBase(l.expense.amountBase, allocated.get(l.expenseId) ?? new D(0)).toFixed(
        2,
      ),
      note: l.note,
    })),
  );
  const residual = lines.reduce<Dec>((acc, l) => acc.plus(new D(l.remainingOpen)), new D(0));
  return {
    number: s.number,
    status: s.status,
    statementSuperseded: isStatementSuperseded(s),
    company: {
      name: profile.data?.name ?? "",
      orgNumber: profile.data?.orgNumber ?? null,
      address: profile.data?.address ?? null,
    },
    payee: s.paymentSource.label,
    refund: {
      bookingDate: t?.bookingDate ?? "",
      amount: s.refundAmount.toFixed(2),
      currency: s.refundCurrency,
      base: s.refundBase.toFixed(2),
      account: t?.accountLabel ?? "",
    },
    lines,
    totals: {
      allocatedBase: s.allocatedBase.toFixed(2),
      exchangeDifferenceBase: s.exchangeDifferenceBase.toFixed(2),
      roundingBase: s.roundingBase.toFixed(2),
      exchangeDifferenceBasCode: s.exchangeDifferenceBasCode,
      residualOpen: residual.toFixed(2),
    },
    note: s.note,
    createdAt: s.createdAt,
  };
}
