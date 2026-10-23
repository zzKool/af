// Expenses (FR-003, FR-004; US1, US2): one cost the company bears, in a group, with a key that is the receipt's
// file name, an SEK base and who paid. Private → the base is the ECB rate of the date; company-paid → provisional
// until the bank row is attached (then the bank's SEK, `rate_source = bank`, a `justifies` link). The money facts
// change only while the expense is open; the key never changes. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { Expense } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { type AppError, RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY, CURRENCIES } from "@/kernel/nav/constants";
import { basCode, isoDate, money, positiveMoney, uuid } from "@/kernel/validation/scalars";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as journal from "@/modules/journal";
import * as linking from "@/modules/linking";
import { expenseDocumentKey, expenseRef, expenseSeries, nextInSeries } from "@/modules/numbering";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import { invalid, notFound, violation } from "./errors";
import {
  EXPENSE_KINDS,
  type ExpenseDto,
  type ExpenseKind,
  type ExpenseRateSource,
  type PaymentSourceDto,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

// --- Zod schemas (the boundary) ---

const positiveRate = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Use digits with up to 6 decimals")
  .refine((v) => Number(v) > 0, "The rate must be positive");

export const duplicateAckSchema = z.object({
  entityIds: z.array(uuid).min(1).max(5),
  note: z.string().trim().min(1, "Say why it is not a duplicate").max(500),
});

/** The note as stored when a duplicate was acknowledged: the owner's reason first, the typed note after. */
export function noteWithAck(
  note: string | null | undefined,
  ack?: { note: string } | null,
): string | null {
  if (!ack) return note ?? null;
  const reason = `Not a duplicate: ${ack.note}`;
  return note ? `${reason}\n${note}` : reason;
}

export const expenseInputSchema = z.object({
  groupId: uuid,
  kind: z.enum(EXPENSE_KINDS).optional(),
  date: isoDate,
  description: z.string().trim().min(1, "Description is required").max(200),
  basCode,
  amount: positiveMoney,
  currency: z.enum(CURRENCIES),
  vatAmount: money.nullable().optional(),
  vatRegistrationId: uuid.nullable().optional(),
  paymentSourceId: uuid,
  /** typed by hand → rate_source = manual; omitted → ECB of the date */
  rate: positiveRate.optional(),
  documentMissing: z.boolean().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  /** the uploaded receipt this expense is created from (D27) */
  documentId: uuid.optional(),
  /** "Create anyway" on a high duplicate match (specs/documents US3): which entities, and why it is not one */
  duplicateAck: duplicateAckSchema.optional(),
});
export type ExpenseInput = z.input<typeof expenseInputSchema>;

export const updateExpenseSchema = expenseInputSchema
  .omit({ documentId: true, kind: true, duplicateAck: true })
  .partial();
export type UpdateExpenseInput = z.input<typeof updateExpenseSchema>;

export const attachSchema = z.object({ expenseId: uuid, bankTransactionId: uuid });
export type AttachInput = z.input<typeof attachSchema>;

// --- DTO mapping ---

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function toExpenseDto(row: Expense): ExpenseDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    groupId: row.groupId,
    key: row.key,
    seq: row.seq,
    alias: row.alias,
    kind: row.kind as ExpenseKind,
    date: iso(row.date) ?? "",
    description: row.description,
    basCode: row.basCode,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    vatAmount: row.vatAmount ? row.vatAmount.toFixed(2) : null,
    vatRegistrationId: row.vatRegistrationId,
    amountBase: row.amountBase.toFixed(2),
    rate: row.rate.toString(),
    rateSource: row.rateSource as ExpenseRateSource,
    rateDate: iso(row.rateDate),
    baseProvisional: row.baseProvisional,
    paidAmount: row.paidAmount ? row.paidAmount.toFixed(2) : null,
    paidCurrency: row.paidCurrency,
    paymentSourceId: row.paymentSourceId,
    documentMissing: row.documentMissing,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

// --- the SEK base ---

type Base = { amountBase: Dec; rate: Dec; rateSource: ExpenseRateSource; rateDate: string | null };

/** round(amount × rate, 2) half-up. */
export function baseAmount(amount: Dec | string, rate: Dec | string): Dec {
  return new D(amount).mul(new D(rate)).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

async function baseFor(
  tx: TransactionClient,
  date: string,
  amount: Dec,
  currency: string,
  typedRate: string | undefined,
): Promise<ServiceResult<Base>> {
  if (typedRate !== undefined) {
    if (currency === BASE_CURRENCY && !new D(typedRate).eq(1)) {
      return { error: invalid(`The rate of a ${BASE_CURRENCY} amount is 1`) };
    }
    const rate = new D(typedRate);
    return {
      data: {
        amountBase: baseAmount(amount, rate),
        rate,
        rateSource: currency === BASE_CURRENCY ? "same_currency" : "manual",
        rateDate: null,
      },
    };
  }
  const r = await rates.rateToBase(tx, date, currency, BASE_CURRENCY);
  if (!r) {
    return {
      error: violation(`No exchange rate for ${date} — run the ECB sync`, { date, currency }),
    };
  }
  return {
    data: {
      amountBase: baseAmount(amount, r.rate),
      rate: r.rate,
      rateSource: r.source,
      rateDate: r.source === "same_currency" ? null : r.rateDate,
    },
  };
}

/** Company-paid and the money will arrive in another currency than the receipt's SEK: the ECB base is an estimate. */
function isProvisional(source: PaymentSourceDto, currency: string): boolean {
  if (source.kind !== "bank_account") return false;
  return currency !== BASE_CURRENCY || source.currency !== BASE_CURRENCY;
}

// --- validation of the owner's facts ---

async function resolveAlias(tx: TransactionClient, code: string): Promise<ServiceResult<string>> {
  const cat = await settings.getBasCategory(tx, code);
  if (!cat) return { error: notFound("BAS category", code) };
  const alias = await settings.basAlias(tx, code);
  if (!alias) {
    return {
      error: violation(
        `Category ${code} ${cat.name} has no short code — set one under Settings → BAS categories`,
        { basCode: code },
      ),
    };
  }
  if (!/^[A-Za-z]{1,6}$/.test(alias)) {
    return {
      error: violation(
        `The short code "${alias}" of category ${code} must be 1–6 letters to be part of a key`,
        { basCode: code },
      ),
    };
  }
  return { data: alias };
}

async function resolveSource(
  tx: TransactionClient,
  id: string,
  mustBeActive: boolean,
): Promise<ServiceResult<PaymentSourceDto>> {
  const row = await tx.paymentSource.findUnique({ where: { id } });
  if (!row) return { error: notFound("Payment source", id) };
  if (mustBeActive && !row.isActive) {
    return { error: violation(`Payment source ${row.label} is inactive`) };
  }
  return {
    data: {
      id: row.id,
      tenantId: row.tenantId,
      label: row.label,
      kind: row.kind,
      bankAccountId: row.bankAccountId,
      currency: row.currency,
      isActive: row.isActive,
      ownerUserId: row.ownerUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

async function checkVatRegistration(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string | null | undefined,
): Promise<AppError | null> {
  if (!id) return null;
  const regs = await settings.getVatRegistrations(tx, caller);
  if (!(regs.data ?? []).some((r) => r.id === id)) return notFound("VAT registration", id);
  return null;
}

/**
 * THE "open" rule (D37, F62): an expense is a draft — its money facts may change — until its first payment, i.e.
 * a settlement line (any, a cancelled settlement's too: "from then on") or a `justifies` link onto it (the paying
 * bank row; linking lets only *attach* write it, F58). The lock trigger `expenses_lock_when_settled` tests the same
 * two facts, so the database refuses what this refuses. *Detach* removes the link before it rewrites the money.
 */
async function isOpen(tx: TransactionClient, id: string): Promise<boolean> {
  const [lines, links] = await Promise.all([
    tx.settlementLine.count({ where: { expenseId: id } }),
    linking.linksTouching(tx, "expense", [id], { kinds: ["justifies"] }),
  ]);
  const payments = links.filter((l) => l.to.type === "expense" && l.to.id === id);
  return lines === 0 && payments.length === 0;
}

// --- writes ---

export async function createExpense(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: ExpenseInput,
): Promise<ServiceResult<ExpenseDto>> {
  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;

  // 1. everything that can fail, before any write
  const group = await tx.expenseGroup.findUnique({ where: { id: v.groupId } });
  if (!group) return { error: notFound("Expense group", v.groupId) };
  const alias = await resolveAlias(tx, v.basCode);
  if (alias.error) return { error: alias.error };
  const source = await resolveSource(tx, v.paymentSourceId, true);
  if (source.error) return { error: source.error };
  const vatError = await checkVatRegistration(tx, caller, v.vatRegistrationId);
  if (vatError) return { error: vatError };
  const amount = new D(v.amount);
  const base = await baseFor(tx, v.date, amount, v.currency, v.rate);
  if (base.error) return { error: base.error };
  if (v.documentId) {
    const doc = await documents.getDocument(tx, v.documentId);
    if (doc.error) return { error: doc.error };
    if (doc.data.status === "generated") {
      return { error: violation("A generated document cannot become an expense") };
    }
    const taken = (await linking.createdFromTargets(tx, [v.documentId])).get(v.documentId);
    if (taken) {
      return {
        error: violation(
          `Document ${doc.data.businessKey} already became ${taken.type} ${taken.id}`,
        ),
      };
    }
  }

  // 2. the key — after validation, in this transaction (the counter rolls back with it)
  const seq = await nextInSeries(tx, caller, expenseSeries(group.number, alias.data));
  const key = expenseRef(group.number, alias.data, seq);

  // 3. the row
  const row = await tx.expense.create({
    data: {
      tenantId: caller.tenantId,
      groupId: group.id,
      key,
      seq,
      alias: alias.data,
      kind: v.kind ?? "receipt",
      date: new Date(v.date),
      description: v.description,
      basCode: v.basCode,
      amount,
      currency: v.currency,
      vatAmount: v.vatAmount ? new D(v.vatAmount) : null,
      vatRegistrationId: v.vatRegistrationId ?? null,
      amountBase: base.data.amountBase,
      rate: base.data.rate,
      rateSource: base.data.rateSource,
      rateDate: base.data.rateDate ? new Date(base.data.rateDate) : null,
      baseProvisional: isProvisional(source.data, v.currency),
      paymentSourceId: source.data.id,
      documentMissing: v.documentMissing ?? false,
      note: noteWithAck(v.note, v.duplicateAck),
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "expense",
    entityId: row.id,
    newData: { ...toAuditData(row), ...(v.duplicateAck ? { duplicateAck: v.duplicateAck } : {}) },
  });

  // 4. the receipt becomes this expense (D27): its key, the created_from link. A failure here rolls everything back.
  if (v.documentId) {
    const renamed = await documents.assignBusinessKey(
      tx,
      caller,
      audit,
      v.documentId,
      expenseDocumentKey(key, v.date),
    );
    if (renamed.error) throw new RollbackError(renamed.error);
    const link = await linking.createLink(tx, caller, audit, {
      from: { type: "expense", id: row.id },
      to: { type: "document", id: v.documentId },
      kind: "created_from",
    });
    if (link.error) throw new RollbackError(link.error);
  }
  return { data: toExpenseDto(row) };
}

const MONEY_FIELDS = ["amount", "currency", "date", "paymentSourceId", "rate"] as const;

export async function updateExpense(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: UpdateExpenseInput,
): Promise<ServiceResult<ExpenseDto>> {
  const parsed = updateExpenseSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const row = await tx.expense.findUnique({ where: { id } });
  if (!row) return { error: notFound("Expense", id) };
  if (v.groupId !== undefined && v.groupId !== row.groupId) {
    return { error: violation(`${row.key} stays in its group — the key carries the group number`) };
  }
  if (v.basCode !== undefined) {
    const cat = await settings.getBasCategory(tx, v.basCode);
    if (!cat) return { error: notFound("BAS category", v.basCode) };
  }
  const vatError = await checkVatRegistration(tx, caller, v.vatRegistrationId);
  if (vatError) return { error: vatError };

  const moneyChange = MONEY_FIELDS.some((f) => v[f] !== undefined);
  const data: Prisma.ExpenseUpdateInput = {
    ...(v.description !== undefined ? { description: v.description } : {}),
    ...(v.basCode !== undefined ? { basCode: v.basCode } : {}),
    ...(v.vatAmount !== undefined ? { vatAmount: v.vatAmount ? new D(v.vatAmount) : null } : {}),
    ...(v.vatRegistrationId !== undefined ? { vatRegistrationId: v.vatRegistrationId } : {}),
    ...(v.documentMissing !== undefined ? { documentMissing: v.documentMissing } : {}),
    ...(v.note !== undefined ? { note: v.note } : {}),
  };
  if (moneyChange) {
    if (!(await isOpen(tx, id))) {
      return {
        error: violation(
          `${row.key} is settled or linked — its amount, currency, date and payer are written`,
        ),
      };
    }
    const currency = v.currency ?? row.currency;
    const date = v.date ?? (iso(row.date) as string);
    const amount = v.amount ? new D(v.amount) : row.amount;
    const sourceId = v.paymentSourceId ?? row.paymentSourceId;
    const source = await resolveSource(tx, sourceId, v.paymentSourceId !== undefined);
    if (source.error) return { error: source.error };
    const base = await baseFor(tx, date, amount, currency, v.rate);
    if (base.error) return { error: base.error };
    Object.assign(data, {
      amount,
      currency,
      date: new Date(date),
      paymentSource: { connect: { id: sourceId } },
      amountBase: base.data.amountBase,
      rate: base.data.rate,
      rateSource: base.data.rateSource,
      rateDate: base.data.rateDate ? new Date(base.data.rateDate) : null,
      baseProvisional: isProvisional(source.data, currency),
    });
  }
  const updated = await tx.expense.update({ where: { id }, data });
  await audit.log({
    action: "update",
    entityType: "expense",
    entityId: id,
    oldData: toAuditData(row),
    newData: toAuditData(updated),
  });
  return { data: toExpenseDto(updated) };
}

/**
 * Delete an open expense. Its `created_from` link alone does not block (D36): it goes through linking, and the
 * receipt returns to the inbox as *ready* — corrections and the key it got kept (keys are never reused). Any other
 * link, a settlement line or a payment still refuses.
 */
export async function deleteExpense(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: true }>> {
  const row = await tx.expense.findUnique({ where: { id } });
  if (!row) return { error: notFound("Expense", id) };
  if (!(await isOpen(tx, id))) {
    return { error: violation(`${row.key} is settled or paid and cannot be deleted`) };
  }
  const links = await linking.linksTouching(tx, "expense", [id]);
  if (links.some((l) => l.kind !== "created_from"))
    return {
      error: violation(`${row.key} is linked and cannot be deleted — remove its links first`),
    };
  for (const l of links) {
    const removed = await linking.removeLink(tx, caller, audit, l.id);
    if (removed.error) throw new RollbackError(removed.error);
  }
  await tx.expense.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "expense",
    entityId: id,
    oldData: toAuditData(row),
  });
  return { data: { deleted: true } };
}

/**
 * A company-paid expense meets its bank row (FR-004, D26): what the bank paid becomes `paid_amount / paid_currency`,
 * the row's journal base becomes the expense's base (`rate_source = bank`), and the row justifies the expense with
 * an allocation of the paid amount. A 45.00 CHF receipt on the SEK card → paid 523.17 SEK, base 523.17.
 */
export async function attachBankTransaction(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { expenseId: string; bankTransactionId: string },
): Promise<ServiceResult<ExpenseDto>> {
  const parsed = attachSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const row = await tx.expense.findUnique({ where: { id: parsed.data.expenseId } });
  if (!row) return { error: notFound("Expense", parsed.data.expenseId) };
  const source = await resolveSource(tx, row.paymentSourceId, false);
  if (source.error) return { error: source.error };
  if (source.data.kind !== "bank_account") {
    return {
      error: violation(
        `${row.key} was paid privately (${source.data.label}) — it is refunded through a settlement, not a bank row`,
      ),
    };
  }
  if (row.paidAmount)
    return { error: violation(`${row.key} already has its bank row — detach it first`) };
  const t = await banking.getBankTransaction(tx, parsed.data.bankTransactionId);
  if (!t) return { error: notFound("Bank transaction", parsed.data.bankTransactionId) };
  if (new D(t.amount).gte(0)) {
    return {
      error: violation(
        `${t.bookingDate} ${t.amount} ${t.currency} is incoming — an expense is paid by an outgoing row`,
      ),
    };
  }
  if (source.data.bankAccountId !== t.bankAccountId) {
    return {
      error: violation(
        `${row.key} is paid from ${source.data.label}, the row is on ${t.accountLabel} — change the payer while the expense is open`,
      ),
    };
  }
  const entries = await journal.entriesForSources(tx, "bank_transaction", [t.id]);
  const entry = entries.get(t.id);
  if (!entry) return { error: violation(`Bank transaction ${t.id} has no journal entry`) };

  const paid = new D(t.amount).abs();
  const updated = await tx.expense.update({
    where: { id: row.id },
    data: {
      paidAmount: paid,
      paidCurrency: t.currency,
      amountBase: new D(entry.amountBase).abs(),
      rate: new D(entry.rate),
      rateSource: "bank",
      rateDate: entry.rateDate ? new Date(entry.rateDate) : null,
      baseProvisional: false,
    },
  });
  await audit.log({
    action: "update",
    entityType: "expense",
    entityId: row.id,
    oldData: {
      amountBase: row.amountBase.toFixed(2),
      rateSource: row.rateSource,
      paidAmount: null,
    },
    newData: {
      bankTransactionId: t.id,
      paidAmount: paid.toFixed(2),
      paidCurrency: t.currency,
      amountBase: updated.amountBase.toFixed(2),
      rateSource: "bank",
    },
  });
  const link = await linking.createLink(
    tx,
    caller,
    audit,
    {
      from: { type: "bank_transaction", id: t.id },
      to: { type: "expense", id: row.id },
      kind: "justifies",
      allocatedAmount: paid.toFixed(2),
      currency: t.currency,
    },
    { owner: "expense" },
  );
  if (link.error) throw new RollbackError(link.error);
  return { data: toExpenseDto(updated) };
}

/** The reverse: the `justifies` links from bank rows go, the base returns to the ECB estimate. */
export async function detachBankTransaction(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  expenseId: string,
): Promise<ServiceResult<ExpenseDto>> {
  const row = await tx.expense.findUnique({ where: { id: expenseId } });
  if (!row) return { error: notFound("Expense", expenseId) };
  if (!row.paidAmount) return { error: violation(`${row.key} has no bank row attached`) };
  const links = (
    await linking.linksTouching(tx, "expense", [expenseId], { kinds: ["justifies"] })
  ).filter(
    (l) => l.from.type === "bank_transaction" && l.to.type === "expense" && l.to.id === expenseId,
  );
  for (const l of links) {
    const removed = await linking.removeLink(tx, caller, audit, l.id, { owner: "expense" });
    if (removed.error) return { error: removed.error };
  }
  const source = await resolveSource(tx, row.paymentSourceId, false);
  if (source.error) return { error: source.error };
  const base = await baseFor(tx, iso(row.date) as string, row.amount, row.currency, undefined);
  if (base.error) throw new RollbackError(base.error);
  const updated = await tx.expense.update({
    where: { id: expenseId },
    data: {
      paidAmount: null,
      paidCurrency: null,
      amountBase: base.data.amountBase,
      rate: base.data.rate,
      rateSource: base.data.rateSource,
      rateDate: base.data.rateDate ? new Date(base.data.rateDate) : null,
      baseProvisional: isProvisional(source.data, row.currency),
    },
  });
  await audit.log({
    action: "update",
    entityType: "expense",
    entityId: expenseId,
    oldData: { paidAmount: row.paidAmount.toFixed(2), paidCurrency: row.paidCurrency },
    newData: {
      paidAmount: null,
      amountBase: updated.amountBase.toFixed(2),
      rateSource: updated.rateSource,
    },
  });
  return { data: toExpenseDto(updated) };
}

// --- the per-diem expense (traktamente writes through here) ---

export const perDiemInputSchema = z.object({
  groupId: uuid,
  date: isoDate,
  description: z.string().trim().min(1).max(200),
  basCode,
  amount: positiveMoney,
  note: z.string().trim().max(4000).nullable().optional(),
});
export type PerDiemInput = z.input<typeof perDiemInputSchema>;

/** The owner's private SEK source — the per-diem is a liability to the owner in SEK (D29). */
async function privateSekSource(tx: TransactionClient): Promise<ServiceResult<PaymentSourceDto>> {
  const row = await tx.paymentSource.findFirst({
    where: { kind: "private", currency: BASE_CURRENCY, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!row)
    return {
      error: violation(`No active private ${BASE_CURRENCY} payment source — create "Private SE"`),
    };
  return resolveSource(tx, row.id, true);
}

export async function createPerDiemExpense(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: PerDiemInput,
): Promise<ServiceResult<ExpenseDto>> {
  const parsed = perDiemInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const source = await privateSekSource(tx);
  if (source.error) return { error: source.error };
  return createExpense(tx, caller, audit, {
    groupId: parsed.data.groupId,
    kind: "per_diem",
    date: parsed.data.date,
    description: parsed.data.description,
    basCode: parsed.data.basCode,
    amount: parsed.data.amount,
    currency: BASE_CURRENCY,
    paymentSourceId: source.data.id,
    documentMissing: false,
    note: parsed.data.note ?? null,
  });
}

/** Recompute (US3-2): the amount, date, description and note of an OPEN per-diem expense are replaced. */
export async function replacePerDiemExpense(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: Omit<PerDiemInput, "groupId" | "basCode">,
): Promise<ServiceResult<ExpenseDto>> {
  const row = await tx.expense.findUnique({ where: { id } });
  if (!row) return { error: notFound("Expense", id) };
  if (row.kind !== "per_diem") return { error: violation(`${row.key} is not a per-diem expense`) };
  if (!(await isOpen(tx, id))) {
    return { error: violation(`${row.key} is settled — a correction is a new per-diem expense`) };
  }
  return updateExpense(tx, caller, audit, id, {
    amount: input.amount,
    date: input.date,
    description: input.description,
    note: input.note ?? null,
  });
}

export async function getExpense(tx: TransactionClient, id: string): Promise<ExpenseDto | null> {
  const row = await tx.expense.findUnique({ where: { id } });
  return row ? toExpenseDto(row) : null;
}

/** Whether the expense can still change its money facts (no settlement line, no payment link) — D37. */
export { isOpen as isExpenseOpen };
