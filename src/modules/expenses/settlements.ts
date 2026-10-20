// Settlements (FR-007, FR-008; US3, US4, D26): one refund transaction settles a chosen set of the owner's private
// expenses, in SEK base. Propose = FIFO (fifo.ts); confirm = validate → number `ST26-001` → row + lines → the
// `settles` link from the bank row → audit (the statement job is enqueued by the action on commit); cancel keeps
// the row and its number, removes the link, reopens the balances. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { Settlement, SettlementLine } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import * as banking from "@/modules/banking";
import * as journal from "@/modules/journal";
import * as linking from "@/modules/linking";
import { nextInSeries, settlementNumber, settlementSeries } from "@/modules/numbering";
import * as settings from "@/modules/settings";
import { invalid, notFound, violation } from "./errors";
import {
  type FifoLine,
  fifoAllocate,
  fifoOrder,
  type OpenExpense,
  residualOpen,
  settlementDifference,
} from "./fifo";
import { OPEN_BASE_TOLERANCE_SEK, openBase } from "./status";
import type {
  SettlementDto,
  SettlementLineDto,
  SettlementProposal,
  SettlementStatus,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

const uuid = z.string().uuid();
const positiveMoney = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Use digits with up to 2 decimals")
  .refine((v) => Number(v) > 0, "The allocation must be positive");

export const proposeSchema = z.object({
  bankTransactionId: uuid,
  paymentSourceId: uuid.optional(),
  /** the owner's ticks: only these expenses, in FIFO order (empty = every open expense of the source) */
  expenseIds: z.array(uuid).optional(),
});
export type ProposeInput = z.input<typeof proposeSchema>;

export const confirmSchema = z.object({
  bankTransactionId: uuid,
  paymentSourceId: uuid,
  lines: z.array(z.object({ expenseId: uuid, allocatedBase: positiveMoney })).min(1),
  confirmExchangeDifference: z.boolean().optional(),
  exchangeDifferenceBasCode: z
    .string()
    .regex(/^\d{3,4}$/)
    .nullable()
    .optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type ConfirmInput = z.input<typeof confirmSchema>;

// --- DTO ---

export function toSettlementDto(row: Settlement & { lines: SettlementLine[] }): SettlementDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    number: row.number,
    bankTransactionId: row.bankTransactionId,
    paymentSourceId: row.paymentSourceId,
    refundAmount: row.refundAmount.toFixed(2),
    refundCurrency: row.refundCurrency,
    refundBase: row.refundBase.toFixed(2),
    allocatedBase: row.allocatedBase.toFixed(2),
    exchangeDifferenceBase: row.exchangeDifferenceBase.toFixed(2),
    roundingBase: row.roundingBase.toFixed(2),
    exchangeDifferenceBasCode: row.exchangeDifferenceBasCode,
    note: row.note,
    status: row.status as SettlementStatus,
    cancelledAt: row.cancelledAt,
    statementDocumentId: row.statementDocumentId,
    statementSuperseded: row.statementSuperseded,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
    lines: row.lines.map(toLineDto),
  };
}

function toLineDto(l: SettlementLine): SettlementLineDto {
  return {
    id: l.id,
    settlementId: l.settlementId,
    expenseId: l.expenseId,
    allocatedBase: l.allocatedBase.toFixed(2),
    note: l.note,
  };
}

// --- reads the proposal and the confirmation share ---

type Refund = {
  id: string;
  bookingDate: string;
  amount: Dec;
  currency: string;
  base: Dec;
};

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
  const entries = await journal.entriesForSources(tx, "bank_transaction", [id]);
  const entry = entries.get(id);
  if (!entry) return { error: violation(`Bank transaction ${id} has no journal entry`) };
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

/** Open private expenses of one source (or all private sources), with what is still open on each. */
export async function openPrivateExpenses(
  tx: TransactionClient,
  paymentSourceId?: string,
): Promise<(OpenExpense & { paymentSourceId: string; currency: string; amount: string })[]> {
  const rows = await tx.expense.findMany({
    where: {
      paymentSource: { kind: "private", ...(paymentSourceId ? { id: paymentSourceId } : {}) },
    },
    include: { settlementLines: { include: { settlement: { select: { status: true } } } } },
    orderBy: [{ date: "asc" }, { key: "asc" }],
  });
  const out = [];
  for (const r of rows) {
    const allocated = r.settlementLines
      .filter((l) => l.settlement.status === "active")
      .reduce<Dec>((acc, l) => acc.plus(l.allocatedBase), new D(0));
    const open = openBase(r.amountBase, allocated);
    if (open.lte(OPEN_BASE_TOLERANCE_SEK)) continue;
    out.push({
      expenseId: r.id,
      key: r.key,
      date: r.date.toISOString().slice(0, 10),
      description: r.description,
      amountBase: r.amountBase.toFixed(2),
      openBase: open.toFixed(2),
      paymentSourceId: r.paymentSourceId,
      currency: r.currency,
      amount: r.amount.toFixed(2),
    });
  }
  return out;
}

function toProposal(
  refund: Refund,
  sourceId: string | null,
  lines: FifoLine[],
): SettlementProposal {
  const diff = settlementDifference(lines, refund.base);
  return {
    bankTransactionId: refund.id,
    bookingDate: refund.bookingDate,
    refundAmount: refund.amount.toFixed(2),
    refundCurrency: refund.currency,
    refundBase: refund.base.toFixed(2),
    paymentSourceId: sourceId,
    lines: lines.map((l) => ({
      expenseId: l.expenseId,
      key: l.key,
      date: l.date,
      description: l.description,
      amountBase: l.amountBase,
      openBase: l.openBase,
      allocatedBase: l.allocatedBase,
      remainingOpen: l.remainingOpen,
    })),
    allocatedBase: diff.allocatedBase,
    exchangeDifferenceBase: diff.exchangeDifferenceBase,
    roundingBase: diff.roundingBase,
    residualOpen: residualOpen(lines),
    unallocatedOnTransaction: diff.unallocatedOnTransaction,
  };
}

/** FIFO over the open private expenses (of the source, of the ticked ids) — nothing written. */
export async function proposeSettlement(
  tx: TransactionClient,
  input: ProposeInput,
): Promise<ServiceResult<SettlementProposal>> {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const refund = await resolveRefund(tx, parsed.data.bankTransactionId);
  if (refund.error) return { error: refund.error };
  let open = await openPrivateExpenses(tx, parsed.data.paymentSourceId);
  if (parsed.data.expenseIds?.length) {
    const wanted = new Set(parsed.data.expenseIds);
    open = open.filter((e) => wanted.has(e.expenseId));
  }
  const sources = new Set(open.map((e) => e.paymentSourceId));
  const sourceId = parsed.data.paymentSourceId ?? (sources.size === 1 ? [...sources][0] : null);
  const lines = fifoAllocate(open, refund.data.base);
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

  // 1. the refund and the source
  const refund = await resolveRefund(tx, v.bankTransactionId);
  if (refund.error) return { error: refund.error };
  const source = await tx.paymentSource.findUnique({ where: { id: v.paymentSourceId } });
  if (!source) return { error: notFound("Payment source", v.paymentSourceId) };
  if (source.kind !== "private") {
    return {
      error: violation(`${source.label} is a company account — only private expenses are settled`),
    };
  }
  if (v.exchangeDifferenceBasCode) {
    const cat = await settings.getBasCategory(tx, v.exchangeDifferenceBasCode);
    if (!cat) return { error: notFound("BAS category", v.exchangeDifferenceBasCode) };
  }

  // 2. every line against what is open (US4-5)
  const open = new Map((await openPrivateExpenses(tx, source.id)).map((e) => [e.expenseId, e]));
  const seen = new Set<string>();
  const lines: FifoLine[] = [];
  for (const l of v.lines) {
    if (seen.has(l.expenseId)) return { error: invalid("An expense appears twice in the lines") };
    seen.add(l.expenseId);
    const e = open.get(l.expenseId);
    if (!e) {
      const row = await tx.expense.findUnique({
        where: { id: l.expenseId },
        include: { paymentSource: true },
      });
      if (!row) return { error: notFound("Expense", l.expenseId) };
      if (row.paymentSource.kind !== "private") {
        return {
          error: violation(
            `${row.key} was paid from ${row.paymentSource.label} — a company-paid expense is never settled`,
          ),
        };
      }
      if (row.paymentSourceId !== source.id) {
        return {
          error: violation(`${row.key} belongs to ${row.paymentSource.label}, not ${source.label}`),
        };
      }
      return { error: violation(`${row.key} has nothing open`) };
    }
    const take = new D(l.allocatedBase);
    if (take.gt(new D(e.openBase))) {
      return {
        error: violation(
          `${e.key}: ${take.toFixed(2)} exceeds its open ${e.openBase} ${BASE_CURRENCY}`,
        ),
      };
    }
    lines.push({
      ...e,
      allocatedBase: take.toFixed(2),
      remainingOpen: new D(e.openBase).minus(take).toFixed(2),
    });
  }
  const ordered = fifoOrder(lines);
  const diff = settlementDifference(ordered, refund.data.base);
  if (new D(diff.exchangeDifferenceBase).gt(0) && !v.confirmExchangeDifference) {
    return {
      error: violation(
        `Allocations exceed the refund by ${diff.exchangeDifferenceBase} ${BASE_CURRENCY} — confirm the exchange difference`,
        { exchangeDifferenceBase: diff.exchangeDifferenceBase },
      ),
    };
  }

  // 3. the number — after validation, in this transaction
  const seq = await nextInSeries(tx, caller, settlementSeries(refund.data.bookingDate));
  const number = settlementNumber(refund.data.bookingDate, seq);

  // 4. the row, its lines (the rounding note on the last line), the link
  const row = await tx.settlement.create({
    data: {
      tenantId: caller.tenantId,
      number,
      bankTransactionId: refund.data.id,
      paymentSourceId: source.id,
      refundAmount: refund.data.amount,
      refundCurrency: refund.data.currency,
      refundBase: refund.data.base,
      allocatedBase: new D(diff.allocatedBase),
      exchangeDifferenceBase: new D(diff.exchangeDifferenceBase),
      roundingBase: new D(diff.roundingBase),
      exchangeDifferenceBasCode: v.exchangeDifferenceBasCode ?? null,
      note: v.note ?? null,
      createdBy: caller.userId,
      source: caller.source,
      lines: {
        create: ordered.map((l, i) => ({
          tenantId: caller.tenantId,
          expenseId: l.expenseId,
          allocatedBase: new D(l.allocatedBase),
          note: i === ordered.length - 1 ? diff.roundingNote : null,
          createdBy: caller.userId,
          source: caller.source,
        })),
      },
    },
    include: { lines: true },
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
        allocatedBase: l.allocatedBase,
      })),
    },
  });
  const link = await linking.createLink(tx, caller, audit, {
    from: { type: "bank_transaction", id: refund.data.id },
    to: { type: "settlement", id: row.id },
    kind: "settles",
    allocatedAmount: refund.data.amount.abs().toFixed(2),
    currency: refund.data.currency,
  });
  if (link.error) throw new RollbackError(link.error);
  return { data: toSettlementDto(row) };
}

/** Cancel (US4-6): status, the link goes, the balances reopen; number and statement stay (flagged superseded). */
export async function cancelSettlement(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<SettlementDto>> {
  const row = await tx.settlement.findUnique({ where: { id }, include: { lines: true } });
  if (!row) return { error: notFound("Settlement", id) };
  if (row.status === "cancelled") return { error: violation(`${row.number} is already cancelled`) };
  const links = await tx.link.findMany({
    where: { kind: "settles", toType: "settlement", toId: id },
    select: { id: true },
  });
  for (const l of links) {
    const removed = await linking.removeLink(tx, caller, audit, l.id);
    if (removed.error) return { error: removed.error };
  }
  const updated = await tx.settlement.update({
    where: { id },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      statementSuperseded: row.statementDocumentId !== null,
    },
    include: { lines: true },
  });
  await audit.log({
    action: "update",
    entityType: "settlement",
    entityId: id,
    oldData: { status: "active" },
    newData: { status: "cancelled", statementSuperseded: updated.statementSuperseded },
  });
  return { data: toSettlementDto(updated) };
}

export async function getSettlement(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<SettlementDto>> {
  const row = await tx.settlement.findUnique({ where: { id }, include: { lines: true } });
  if (!row) return { error: notFound("Settlement", id) };
  return { data: toSettlementDto(row) };
}
