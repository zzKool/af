// Settlements (FR-007, FR-008; US3, US4, D26, F114 / D60): one refund row reimburses a chosen set of the owner's
// private expenses — each reimbursement is a `settles` link from the row to the expense, carrying what it refunds
// of the expense (its currency) and the base the row gave for it. The settlement is the numbered statement over
// those links (`ST26-001`, its PDF, cancel with the number kept): Σ base, the rounding and the FX difference are
// derived, never stored. Propose = FIFO in base (fifo.ts); confirm = validate → number → row + links → audit (the
// statement job is enqueued by the action on commit); cancel removes the links, the balances reopen.
// MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { Settlement } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { fxDifference, isSettled } from "@/kernel/money/settlement";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import { money, uuid } from "@/kernel/validation/scalars";
import * as banking from "@/modules/banking";
import * as linking from "@/modules/linking";
import { nextInSeries, settlementNumber, settlementSeries } from "@/modules/numbering";
import { invalid, notFound, violation } from "./errors";
import { type FifoLine, fifoAllocate, fifoOrder, type OpenExpense, residualOpen } from "./fifo";
import {
  amountForBase,
  differenceBasCode,
  expectedBaseFor,
  settlementTotals,
} from "./settlement-math";
import { openBase, openOn } from "./status";
import type {
  SettlementDto,
  SettlementLineDto,
  SettlementProposal,
  SettlementStatus,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

const positiveAllocation = money.refine((v) => Number(v) > 0, "The allocation must be positive");

export const proposeSchema = z.object({
  bankTransactionId: uuid,
  /** narrow the open expenses to one private instrument (optional — the owner is the owner, whatever the card) */
  paidFromAccountId: uuid.optional(),
  /** the owner's ticks: only these expenses, in FIFO order (empty = every open private expense) */
  expenseIds: z.array(uuid).optional(),
});
export type ProposeInput = z.input<typeof proposeSchema>;

export const confirmSchema = z.object({
  bankTransactionId: uuid,
  lines: z
    .array(
      z.object({
        expenseId: uuid,
        /** the base the refund row gives for this expense */
        allocatedBase: positiveAllocation,
        /**
         * what it refunds of the expense, in the expense's currency; omitted = the share the base covers of what
         * is open (the whole of it when the base covers the claim within the tolerance). The owner states the
         * full amount when he accepted less base than the claim (a cross-currency refund — the difference shows).
         */
        allocatedAmount: positiveAllocation.optional(),
      }),
    )
    .min(1),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type ConfirmInput = z.input<typeof confirmSchema>;

// --- DTO ---

/** A statement is superseded when its settlement is cancelled — derived, whenever the statement was stored (F62). */
export function isStatementSuperseded(row: {
  status: string;
  statementDocumentId: string | null;
}): boolean {
  return row.status === "cancelled" && row.statementDocumentId !== null;
}

type Refund = {
  id: string;
  bookingDate: string;
  amount: Dec;
  currency: string;
  base: Dec;
};

type LineFacts = SettlementLineDto;

function toDto(
  row: Settlement,
  refund: { bookingDate: string; amount: string; currency: string; base: string },
  lines: LineFacts[],
): SettlementDto {
  const totals = settlementTotals(lines, refund.base);
  return {
    id: row.id,
    tenantId: row.tenantId,
    number: row.number,
    bankTransactionId: row.bankTransactionId,
    refundAmount: refund.amount,
    refundCurrency: refund.currency,
    refundBase: refund.base,
    bookingDate: refund.bookingDate,
    allocatedBase: totals.allocatedBase.toFixed(2),
    expectedBase: totals.expectedBase.toFixed(2),
    differenceBase: totals.differenceBase.toFixed(2),
    rounding: totals.rounding,
    differenceBasCode: differenceBasCode(totals.differenceBase, totals.rounding),
    unallocatedBase: totals.unallocatedBase.toFixed(2),
    note: row.note,
    status: row.status as SettlementStatus,
    cancelledAt: row.cancelledAt,
    statementDocumentId: row.statementDocumentId,
    statementSuperseded: isStatementSuperseded(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
    lines,
  };
}

/**
 * The lines of ACTIVE settlements: the `settles` links from each settlement's row, with the expense's facts and the
 * base the books carried for the refunded share. A cancelled settlement has none left (cancel removed them).
 */
async function linesFor(
  tx: TransactionClient,
  rows: readonly Settlement[],
): Promise<Map<string, LineFacts[]>> {
  const out = new Map<string, LineFacts[]>();
  const active = rows.filter((r) => r.status === "active");
  if (active.length === 0) return out;
  const links = (
    await linking.linksTouching(
      tx,
      "bank_transaction",
      active.map((r) => r.bankTransactionId),
      { kinds: ["settles"] },
    )
  ).filter(
    (l) => l.from.type === "bank_transaction" && l.to.type === "expense" && l.allocatedAmount,
  );
  const expenses = await tx.expense.findMany({
    where: { id: { in: [...new Set(links.map((l) => l.to.id))] } },
    select: {
      id: true,
      key: true,
      date: true,
      description: true,
      amount: true,
      currency: true,
      amountBase: true,
    },
  });
  const byId = new Map(expenses.map((e) => [e.id, e]));
  for (const s of active) {
    const own = links.filter((l) => l.from.id === s.bankTransactionId);
    const lines: LineFacts[] = [];
    for (const l of own) {
      const e = byId.get(l.to.id);
      if (!e) continue;
      const share = fxDifference(e.amount, e.amountBase, [
        { amount: l.allocatedAmount ?? "0", base: l.allocatedBase ?? "0" },
      ]);
      lines.push({
        linkId: l.id,
        expenseId: e.id,
        key: e.key,
        date: e.date.toISOString().slice(0, 10),
        description: e.description,
        allocatedAmount: l.allocatedAmount ?? "0.00",
        currency: l.currency ?? e.currency,
        allocatedBase: l.allocatedBase ?? "0.00",
        expectedBase: share.expectedBase.toFixed(2),
        note: l.note,
      });
    }
    out.set(s.id, fifoOrder(lines));
  }
  return out;
}

/** The settlements as DTOs — their row's facts and their lines read once for the set. */
export async function settlementDtos(
  tx: TransactionClient,
  rows: readonly Settlement[],
): Promise<SettlementDto[]> {
  if (rows.length === 0) return [];
  const facts = await banking.transactionFacts(
    tx,
    rows.map((r) => r.bankTransactionId),
  );
  const lines = await linesFor(tx, rows);
  return rows.map((r) => {
    const t = facts.get(r.bankTransactionId);
    return toDto(
      r,
      {
        bookingDate: t?.bookingDate ?? "",
        amount: t?.amount ?? "0.00",
        currency: t?.currency ?? BASE_CURRENCY,
        base: t ? new D(t.amountBase).abs().toFixed(2) : "0.00",
      },
      lines.get(r.id) ?? [],
    );
  });
}

// --- reads the proposal and the confirmation share ---

/** The refund: an outgoing row on an own main account, not already settling (US4-5). */
async function resolveRefund(tx: TransactionClient, id: string): Promise<ServiceResult<Refund>> {
  const t = await banking.getBankTransaction(tx, id);
  if (!t) return { error: notFound("Bank transaction", id) };
  if (new D(t.amount).gte(0)) {
    return {
      error: violation(
        `${t.bookingDate} ${t.amount} ${t.currency} is incoming — a refund to the owner is an outgoing row`,
      ),
    };
  }
  if (t.accountRole !== "main") {
    return {
      error: violation(
        `${t.accountLabel} is a ${t.accountRole} account — refunds leave a main account`,
      ),
    };
  }
  const active = await tx.settlement.findFirst({
    where: { bankTransactionId: id, status: "active" },
    select: { number: true },
  });
  if (active) return { error: violation(`This transaction already settles ${active.number}`) };
  const entries = await banking.transactionFacts(tx, [id]);
  const entry = entries.get(id);
  if (!entry) return { error: violation(`Bank transaction ${id} not found`) };
  return {
    data: {
      id: t.id,
      bookingDate: t.bookingDate,
      amount: new D(t.amount),
      currency: t.currency,
      base: new D(entry.amountBase).abs(),
    },
  };
}

/**
 * The bank rows an ACTIVE settlement refunds through (lessons audit 23) — the rows the settle and payment pickers
 * leave out. `among` narrows the read to those rows; a cancelled settlement frees its row.
 */
export async function activeSettlementTransactionIds(
  tx: TransactionClient,
  among?: readonly string[],
): Promise<Set<string>> {
  if (among?.length === 0) return new Set();
  const rows = await tx.settlement.findMany({
    where: { status: "active", ...(among ? { bankTransactionId: { in: [...among] } } : {}) },
    select: { bankTransactionId: true },
  });
  return new Set(rows.map((r) => r.bankTransactionId));
}

export type OpenPrivateExpense = OpenExpense & {
  paidFromAccountId: string;
  currency: string;
  amount: string;
  /** what is still open of the amount, the expense's currency */
  openAmount: string;
};

/** Private expenses (of one instrument, or all) the company still owes something on — the claim in base. */
export async function openPrivateExpenses(
  tx: TransactionClient,
  paidFromAccountId?: string,
): Promise<OpenPrivateExpense[]> {
  const rows = await tx.expense.findMany({
    where: {
      paidFromAccount: {
        role: "owner_private",
        ...(paidFromAccountId ? { id: paidFromAccountId } : {}),
      },
    },
    orderBy: [{ date: "asc" }, { key: "asc" }],
  });
  const allocations = await linking.allocationsOnto(
    tx,
    "expense",
    rows.map((r) => r.id),
  );
  const out: OpenPrivateExpense[] = [];
  for (const r of rows) {
    const own = allocations.get(r.id) ?? [];
    const claim = openBase(r.amount, r.amountBase, own);
    if (claim.isZero()) continue;
    const allocated = own.reduce((acc, a) => acc.plus(a.amount), new D(0));
    out.push({
      expenseId: r.id,
      key: r.key,
      date: r.date.toISOString().slice(0, 10),
      description: r.description,
      amountBase: r.amountBase.toFixed(2),
      openBase: claim.toFixed(2),
      paidFromAccountId: r.paidFromAccountId,
      currency: r.currency,
      amount: r.amount.toFixed(2),
      openAmount: openOn(r.amount, allocated).toFixed(2),
    });
  }
  return out;
}

function toProposal(
  refund: Refund,
  sourceId: string | null,
  lines: (FifoLine & { amount: string; currency: string; openAmount: string })[],
): SettlementProposal {
  const facts = lines.map((l) => {
    const amount = amountForBase(l, l.allocatedBase);
    return {
      ...l,
      allocatedAmount: amount.toFixed(2),
      expectedBase: expectedBaseFor(l, amount).toFixed(2),
    };
  });
  const totals = settlementTotals(facts, refund.base);
  return {
    bankTransactionId: refund.id,
    bookingDate: refund.bookingDate,
    refundAmount: refund.amount.toFixed(2),
    refundCurrency: refund.currency,
    refundBase: refund.base.toFixed(2),
    paidFromAccountId: sourceId,
    lines: facts.map((l) => ({
      expenseId: l.expenseId,
      key: l.key,
      date: l.date,
      description: l.description,
      amount: l.amount,
      currency: l.currency,
      amountBase: l.amountBase,
      openBase: l.openBase,
      allocatedBase: l.allocatedBase,
      remainingOpen: l.remainingOpen,
    })),
    allocatedBase: totals.allocatedBase.toFixed(2),
    differenceBase: totals.rounding ? "0.00" : totals.differenceBase.toFixed(2),
    roundingBase: totals.rounding ? totals.differenceBase.toFixed(2) : "0.00",
    residualOpen: residualOpen(lines),
    unallocatedOnTransaction: totals.unallocatedBase.toFixed(2),
  };
}

/** FIFO over the open private expenses (of the instrument, of the ticked ids) — nothing written. */
export async function proposeSettlement(
  tx: TransactionClient,
  input: ProposeInput,
): Promise<ServiceResult<SettlementProposal>> {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const refund = await resolveRefund(tx, parsed.data.bankTransactionId);
  if (refund.error) return { error: refund.error };
  let open = await openPrivateExpenses(tx, parsed.data.paidFromAccountId);
  if (parsed.data.expenseIds?.length) {
    const wanted = new Set(parsed.data.expenseIds);
    open = open.filter((e) => wanted.has(e.expenseId));
  }
  const sources = new Set(open.map((e) => e.paidFromAccountId));
  const sourceId = parsed.data.paidFromAccountId ?? (sources.size === 1 ? [...sources][0] : null);
  const byId = new Map(open.map((e) => [e.expenseId, e]));
  const lines = fifoAllocate(open, refund.data.base).map((l) => {
    const e = byId.get(l.expenseId) as OpenPrivateExpense;
    return { ...l, amount: e.amount, currency: e.currency, openAmount: e.openAmount };
  });
  return { data: toProposal(refund.data, sourceId, lines) };
}

// --- writes ---

export async function confirmSettlement(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: ConfirmInput,
): Promise<ServiceResult<SettlementDto>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;

  // 1. the refund
  const refund = await resolveRefund(tx, v.bankTransactionId);
  if (refund.error) return { error: refund.error };

  // 2. every line against what is open (US4-5); the bases against the row
  const open = new Map((await openPrivateExpenses(tx)).map((e) => [e.expenseId, e]));
  const seen = new Set<string>();
  const lines: (OpenPrivateExpense & { allocatedBase: string; allocatedAmount: string })[] = [];
  let givenBase = new D(0);
  for (const l of v.lines) {
    if (seen.has(l.expenseId)) return { error: invalid("An expense appears twice in the lines") };
    seen.add(l.expenseId);
    const e = open.get(l.expenseId);
    if (!e) {
      const row = await tx.expense.findUnique({
        where: { id: l.expenseId },
        include: {
          paidFromAccount: {
            select: { role: true, accountAlias: true, accountNumber: true, currency: true },
          },
        },
      });
      if (!row) return { error: notFound("Expense", l.expenseId) };
      if (row.paidFromAccount.role !== "owner_private") {
        return {
          error: violation(
            `${row.key} was paid from ${banking.accountLabel(row.paidFromAccount)} — a company-paid expense is never settled`,
          ),
        };
      }
      return { error: violation(`${row.key} has nothing open`) };
    }
    const base = new D(l.allocatedBase);
    const amount = l.allocatedAmount ? new D(l.allocatedAmount) : amountForBase(e, base);
    if (amount.gt(new D(e.openAmount))) {
      return {
        error: violation(
          `${e.key}: ${amount.toFixed(2)} ${e.currency} exceeds what is open on it (${e.openAmount})`,
        ),
      };
    }
    givenBase = givenBase.plus(base);
    lines.push({ ...e, allocatedBase: base.toFixed(2), allocatedAmount: amount.toFixed(2) });
  }
  if (givenBase.gt(refund.data.base)) {
    return {
      error: violation(
        `The lines give ${givenBase.toFixed(2)} ${BASE_CURRENCY} — the refund row carries ${refund.data.base.toFixed(2)}`,
      ),
    };
  }
  const ordered = fifoOrder(lines);

  // 3. the number — after validation, in this transaction
  const seq = await nextInSeries(tx, caller, settlementSeries(refund.data.bookingDate));
  const number = settlementNumber(refund.data.bookingDate, seq);

  // 4. the row, then one `settles` link per line
  const row = await tx.settlement.create({
    data: {
      tenantId: caller.tenantId,
      number,
      bankTransactionId: refund.data.id,
      note: v.note ?? null,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "settlement",
    entityId: row.id,
    newData: {
      ...toAuditData(row),
      lines: ordered.map((l) => ({
        expenseId: l.expenseId,
        key: l.key,
        allocatedAmount: l.allocatedAmount,
        currency: l.currency,
        allocatedBase: l.allocatedBase,
      })),
    },
  });
  for (const l of ordered) {
    const link = await linking.createLink(tx, caller, audit, {
      from: { type: "bank_transaction", id: refund.data.id },
      to: { type: "expense", id: l.expenseId },
      kind: "settles",
      allocatedAmount: l.allocatedAmount,
      currency: l.currency,
      allocatedBase: l.allocatedBase,
      note: `Settlement ${number}`,
    });
    if (link.error) throw new RollbackError(link.error);
  }
  const [dto] = await settlementDtos(tx, [row]);
  return { data: dto as SettlementDto };
}

/** Cancel (US4-6): status, the links go, the balances reopen; number and statement stay (read as superseded). */
export async function cancelSettlement(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<SettlementDto>> {
  const row = await tx.settlement.findUnique({ where: { id } });
  if (!row) return { error: notFound("Settlement", id) };
  if (row.status === "cancelled") return { error: violation(`${row.number} is already cancelled`) };
  const [before] = await settlementDtos(tx, [row]);
  const links = (
    await linking.linksTouching(tx, "bank_transaction", [row.bankTransactionId], {
      kinds: ["settles"],
    })
  ).filter((l) => l.from.id === row.bankTransactionId && l.to.type === "expense");
  for (const l of links) {
    const removed = await linking.removeLink(tx, caller, audit, l.id);
    if (removed.error) return { error: removed.error };
  }
  const updated = await tx.settlement.update({
    where: { id },
    data: { status: "cancelled", cancelledAt: new Date() },
  });
  await audit.log({
    action: "update",
    entityType: "settlement",
    entityId: id,
    oldData: {
      status: "active",
      lines: (before?.lines ?? []).map((l) => ({
        expenseId: l.expenseId,
        key: l.key,
        allocatedAmount: l.allocatedAmount,
        currency: l.currency,
        allocatedBase: l.allocatedBase,
      })),
    },
    newData: { status: "cancelled", statementSuperseded: isStatementSuperseded(updated) },
  });
  const [dto] = await settlementDtos(tx, [updated]);
  return { data: dto as SettlementDto };
}

export async function getSettlement(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<SettlementDto>> {
  const row = await tx.settlement.findUnique({ where: { id } });
  if (!row) return { error: notFound("Settlement", id) };
  const [dto] = await settlementDtos(tx, [row]);
  return { data: dto as SettlementDto };
}

/** True when the expense's claim is covered within the tolerance — the statement's "settled" word. */
export function claimSettled(openBaseBefore: string, allocatedBase: string): boolean {
  return isSettled(openBaseBefore, [allocatedBase]);
}

export {
  amountForBase,
  differenceBasCode,
  expectedBaseFor,
  settlementTotals,
} from "./settlement-math";
