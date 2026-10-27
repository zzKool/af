// The reimbursement statement (US4-7, FR-009): what the print route renders and the job stores — the settlement,
// its lines (the `settles` links of its row, F114) with their expenses, the refund row, the company, the totals —
// Σ base, the signed FX difference or the rounding, derived — and the residual left open.
// MUST NOT import from next/* or src/components/*.
import { Prisma } from "@/generated/prisma/browser";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as linking from "@/modules/linking";
import * as settings from "@/modules/settings";
import { groupLabel } from "./groups";
import { settlementDtos } from "./settlements";
import { openBase } from "./status";

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
  /** what this settlement refunds of the expense, its currency */
  allocatedAmount: string;
  /** what the row gave for it, in base */
  allocatedBase: string;
  /** the base the books carried for that share */
  expectedBase: string;
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
    expectedBase: string;
    /** signed: > 0 the company paid more base than the claim (7960), < 0 less (3960); "0.00" when rounding */
    differenceBase: string;
    /** the same difference when it is within the tolerance */
    roundingBase: string;
    differenceBasCode: string | null;
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
  const row = await tx.settlement.findUnique({ where: { id } });
  if (!row) return null;
  const [s] = await settlementDtos(tx, [row]);
  if (!s) return null;
  const profile = await settings.getTenantProfile(tx, caller);
  const t = await banking.getBankTransaction(tx, s.bankTransactionId);
  const expenses = await tx.expense.findMany({
    where: { id: { in: s.lines.map((l) => l.expenseId) } },
    include: {
      group: true,
      paidFromAccount: { select: { accountAlias: true, accountNumber: true, currency: true } },
    },
  });
  const byId = new Map(expenses.map((e) => [e.id, e]));
  // what each expense still owes AFTER this settlement, over every allocation onto it (this one included) —
  // `openBase`, the list's and the ledger's rule: a remainder under the tolerance prints 0.00 (F88, D47)
  const allocations = await linking.allocationsOnto(
    tx,
    "expense",
    s.lines.map((l) => l.expenseId),
  );
  const lines: StatementLine[] = s.lines.flatMap((l) => {
    const e = byId.get(l.expenseId);
    if (!e) return [];
    return [
      {
        key: e.key,
        date: l.date,
        description: e.description,
        group: groupLabel(e.group),
        basCode: e.basCode,
        amount: e.amount.toFixed(2),
        currency: e.currency,
        amountBase: e.amountBase.toFixed(2),
        allocatedAmount: l.allocatedAmount,
        allocatedBase: l.allocatedBase,
        expectedBase: l.expectedBase,
        remainingOpen: openBase(e.amount, e.amountBase, allocations.get(e.id) ?? []).toFixed(2),
        note: l.note,
      },
    ];
  });
  const residual = lines.reduce<Dec>((acc, l) => acc.plus(new D(l.remainingOpen)), new D(0));
  const payees = [...new Set(expenses.map((e) => banking.accountLabel(e.paidFromAccount)))].sort();
  return {
    number: s.number,
    status: s.status,
    statementSuperseded: s.statementSuperseded,
    company: {
      name: profile.data?.name ?? "",
      orgNumber: profile.data?.orgNumber ?? null,
      address: profile.data?.address ?? null,
    },
    payee: payees.join(", "),
    refund: {
      bookingDate: s.bookingDate,
      amount: s.refundAmount,
      currency: s.refundCurrency,
      base: s.refundBase,
      account: t?.accountLabel ?? "",
    },
    lines,
    totals: {
      allocatedBase: s.allocatedBase,
      expectedBase: s.expectedBase,
      differenceBase: s.rounding ? "0.00" : s.differenceBase,
      roundingBase: s.rounding ? s.differenceBase : "0.00",
      differenceBasCode: s.differenceBasCode,
      residualOpen: residual.toFixed(2),
    },
    note: s.note,
    createdAt: s.createdAt,
  };
}
