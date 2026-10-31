// Expenses (FR-003, FR-004; US1, US2): one cost the company bears, in a group, with a key that is the receipt's
// file name, a base at its date and who paid (a bank account: the company's, or a private instrument of the owner).
// The payment is a link and only a link (F114, D60): a `justifies` link from the paying bank row (company-paid), a
// `settles` link from the refund row (private) — each with the amount it pays in the expense's currency and the base
// the row gave; paid / open and the FX difference are derived from them. The money facts change only while the
// expense is open (no allocating link); the key never changes. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { Expense } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { type AppError, RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY, CURRENCIES } from "@/kernel/nav/constants";
import {
  basCode,
  isoDate,
  money,
  positiveMoney,
  positiveRate,
  uuid,
} from "@/kernel/validation/scalars";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as linking from "@/modules/linking";
import { expenseDocumentKey, expenseRef, expenseSeries, nextInSeries } from "@/modules/numbering";
import * as partners from "@/modules/partners";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import { invalid, notFound, violation } from "./errors";
import { EXPENSE_KINDS, type ExpenseDto, type ExpenseKind, type ExpenseRateSource } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

// --- Zod schemas (the boundary) ---

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
  paidFromAccountId: uuid,
  /** typed by hand → rate_source = manual; omitted → ECB of the date */
  rate: positiveRate.optional(),
  documentMissing: z.boolean().optional(),
  /** the merchant as a partner (F87): an active vendor of the tenant; null clears it */
  partnerId: uuid.nullable().optional(),
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

export const paySchema = z.object({
  expenseId: uuid,
  bankTransactionId: uuid,
  /** in the expense's currency; omitted = what is open on it (same currency: no more than the row has left) */
  amount: positiveMoney.optional(),
  /** the base the row gives for it; omitted = pro rata of the row's base (same currency) or the row's remaining base */
  amountBase: positiveMoney.optional(),
});
export type PayInput = z.input<typeof paySchema>;
export const unpaySchema = z.object({ expenseId: uuid, linkId: uuid });
export type UnpayInput = z.input<typeof unpaySchema>;

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
    paidFromAccountId: row.paidFromAccountId,
    documentMissing: row.documentMissing,
    partnerId: row.partnerId,
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

// --- validation of the owner's facts ---

async function resolveAlias(tx: TransactionClient, code: string): Promise<ServiceResult<string>> {
  const cat = await settings.getBasCategory(tx, code);
  if (!cat) return { error: notFound("BAS category", code) };
  const alias = await settings.basAlias(tx, code);
  if (!alias) {
    return {
      error: violation(
        `Category ${code} ${cat.nameEn ?? cat.name} has no short code — set one under Settings → BAS categories`,
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

/** The payer: a main bank account (the company) or a private instrument of the owner — never savings (F114). */
async function resolvePayer(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<banking.PayerAccount>> {
  const payer = await banking.payerAccount(tx, id);
  if (!payer) return { error: notFound("Payer account", id) };
  return { data: payer };
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
 * The expense's partner (F87, FR-001): a partner of this tenant (RLS — another tenant's id is not found), active,
 * with the type `vendor`; a per-diem never has one. Not a money fact — allowed in every state.
 */
async function checkPartner(
  tx: TransactionClient,
  id: string | null | undefined,
  kind: ExpenseKind,
): Promise<AppError | null> {
  if (!id) return null;
  if (kind === "per_diem") {
    return violation("A per-diem has no partner — it is written by its trip", {
      field: "partnerId",
    });
  }
  const p = await partners.getPartner(tx, id);
  if (!p.data || !p.data.isActive) {
    return violation("Unknown or inactive partner", { field: "partnerId" });
  }
  if (!p.data.types.includes("vendor")) {
    return violation(`Pick a vendor — ${p.data.name} is not one`, { field: "partnerId" });
  }
  return null;
}

/**
 * THE "open" rule (D37, F62, F114): an expense is a draft — its money facts may change — until its first payment,
 * i.e. an allocating link onto it (`justifies` from the paying bank row, `settles` from the refund row). The lock
 * trigger `expenses_lock_money_when_linked` tests the same fact, so the database refuses what this refuses.
 */
async function isOpen(tx: TransactionClient, id: string): Promise<boolean> {
  const links = await linking.linksTouching(tx, "expense", [id], {
    kinds: [...linking.ALLOCATING_KINDS],
  });
  return !links.some((l) => l.to.type === "expense" && l.to.id === id && l.allocatedAmount);
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
  const payer = await resolvePayer(tx, v.paidFromAccountId);
  if (payer.error) return { error: payer.error };
  const vatError = await checkVatRegistration(tx, caller, v.vatRegistrationId);
  if (vatError) return { error: vatError };
  const partnerError = await checkPartner(tx, v.partnerId, v.kind ?? "receipt");
  if (partnerError) return { error: partnerError };
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
      paidFromAccountId: payer.data.id,
      documentMissing: v.documentMissing ?? false,
      partnerId: v.partnerId ?? null,
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

const MONEY_FIELDS = ["amount", "currency", "date", "paidFromAccountId", "rate"] as const;

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
  // a partner that stays as it is (a deactivated one kept on the row) is not re-validated; a new one is
  if (v.partnerId !== undefined && v.partnerId !== row.partnerId) {
    const partnerError = await checkPartner(tx, v.partnerId, row.kind as ExpenseKind);
    if (partnerError) return { error: partnerError };
  }

  const moneyChange = MONEY_FIELDS.some((f) => v[f] !== undefined);
  const data: Prisma.ExpenseUncheckedUpdateInput = {
    ...(v.description !== undefined ? { description: v.description } : {}),
    ...(v.basCode !== undefined ? { basCode: v.basCode } : {}),
    ...(v.vatAmount !== undefined ? { vatAmount: v.vatAmount ? new D(v.vatAmount) : null } : {}),
    ...(v.vatRegistrationId !== undefined ? { vatRegistrationId: v.vatRegistrationId } : {}),
    ...(v.documentMissing !== undefined ? { documentMissing: v.documentMissing } : {}),
    ...(v.partnerId !== undefined ? { partnerId: v.partnerId } : {}),
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
    const payerId = v.paidFromAccountId ?? row.paidFromAccountId;
    const payer = await resolvePayer(tx, payerId);
    if (payer.error) return { error: payer.error };
    const base = await baseFor(tx, date, amount, currency, v.rate);
    if (base.error) return { error: base.error };
    Object.assign(data, {
      amount,
      currency,
      date: new Date(date),
      paidFromAccountId: payer.data.id,
      amountBase: base.data.amountBase,
      rate: base.data.rate,
      rateSource: base.data.rateSource,
      rateDate: base.data.rateDate ? new Date(base.data.rateDate) : null,
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
 * The links that go with a deleted expense instead of blocking it: its `created_from` (D36 — the receipt returns to
 * the inbox) and its `occurrence_of` (F94 — an attribution to a subscription, not proof; the period is due again).
 */
const DELETE_WITH_ENTITY: ReadonlySet<string> = new Set(["created_from", "occurrence_of"]);

/**
 * Delete an open expense. Its `created_from` and `occurrence_of` links alone do not block (D36, F94): they go
 * through linking, and the receipt returns to the inbox as *ready* — corrections and the key it got kept (keys are
 * never reused). Any other link, a settlement line or a payment still refuses.
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
    return { error: violation(`${row.key} is paid or refunded and cannot be deleted`) };
  }
  const links = await linking.linksTouching(tx, "expense", [id]);
  if (links.some((l) => !DELETE_WITH_ENTITY.has(l.kind)))
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
 * The receipt arrives after the expense (F94 FR-012 — an expense made from its bank row, the receipt later): the
 * document becomes this expense as `createExpense({documentId})` would have made it — its key renamed to the
 * expense's, the `created_from` link — and `document_missing` is cleared. Allowed in every state: the document is
 * proof, not a money fact (the lock trigger's columns are untouched). Refused when the expense already has its
 * document or the document already became something (the link's exclusivity).
 */
export async function attachDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { expenseId: string; documentId: string },
): Promise<ServiceResult<ExpenseDto>> {
  const row = await tx.expense.findUnique({ where: { id: input.expenseId } });
  if (!row) return { error: notFound("Expense", input.expenseId) };
  if (await linking.hasLinks(tx, { type: "expense", id: row.id }, "created_from")) {
    return { error: violation(`${row.key} already has its document — remove it first`) };
  }
  const link = await linking.createLink(tx, caller, audit, {
    from: { type: "expense", id: row.id },
    to: { type: "document", id: input.documentId },
    kind: "created_from",
  });
  if (link.error) return { error: link.error };
  const renamed = await documents.assignBusinessKey(
    tx,
    caller,
    audit,
    input.documentId,
    expenseDocumentKey(row.key, row.date.toISOString().slice(0, 10)),
  );
  if (renamed.error) throw new RollbackError(renamed.error);
  const updated = row.documentMissing
    ? await tx.expense.update({ where: { id: row.id }, data: { documentMissing: false } })
    : row;
  await audit.log({
    action: "update",
    entityType: "expense",
    entityId: row.id,
    oldData: { documentMissing: row.documentMissing },
    newData: { documentId: input.documentId, documentMissing: false },
  });
  return { data: toExpenseDto(updated) };
}

/**
 * Undo `attachDocument` (or the document a creation attached): the `created_from` link goes through linking and the
 * document is back in the inbox as *ready*, its key kept (keys are never reused, D36). Allowed in every state.
 */
export async function detachDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { expenseId: string },
): Promise<ServiceResult<ExpenseDto>> {
  const row = await tx.expense.findUnique({ where: { id: input.expenseId } });
  if (!row) return { error: notFound("Expense", input.expenseId) };
  const links = await linking.linksTouching(tx, "expense", [row.id], { kinds: ["created_from"] });
  const origin = links.find((l) => l.from.type === "expense" && l.from.id === row.id);
  if (!origin) return { error: violation(`${row.key} has no document to remove`) };
  const removed = await linking.removeLink(tx, caller, audit, origin.id);
  if (removed.error) return { error: removed.error };
  await audit.log({
    action: "update",
    entityType: "expense",
    entityId: row.id,
    oldData: { documentId: origin.to.id },
    newData: { documentId: null },
  });
  return { data: toExpenseDto(row) };
}

/**
 * A company-paid expense is paid by a bank row (FR-004, F114): one `justifies` link carrying the amount it pays in
 * the expense's currency and the base the row gave — nothing on the expense moves. A 45.00 CHF receipt on the SEK
 * card: the link says 45.00 CHF · base 531.40; the receipt keeps its ECB base; the difference is derived. Several
 * rows may pay one expense (a deposit and a balance) and one row several expenses (two receipts on one card row).
 */
export async function payExpense(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: PayInput,
): Promise<
  ServiceResult<ExpenseDto & { linkId: string; allocated: string; allocatedBase: string }>
> {
  const parsed = paySchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const row = await tx.expense.findUnique({ where: { id: parsed.data.expenseId } });
  if (!row) return { error: notFound("Expense", parsed.data.expenseId) };
  const payer = await resolvePayer(tx, row.paidFromAccountId);
  if (payer.error) return { error: payer.error };
  if (payer.data.kind !== "bank_account") {
    return {
      error: violation(
        `${row.key} was paid privately (${payer.data.label}) — it is refunded through a settlement, not a bank row`,
      ),
    };
  }
  const t = await banking.getBankTransaction(tx, parsed.data.bankTransactionId);
  if (!t) return { error: notFound("Bank transaction", parsed.data.bankTransactionId) };
  if (new D(t.amount).gte(0)) {
    return {
      error: violation(
        `${t.bookingDate} ${t.amount} ${t.currency} is incoming — an expense is paid by an outgoing row`,
      ),
    };
  }
  if (payer.data.id !== t.bankAccountId) {
    return {
      error: violation(
        `${row.key} is paid from ${payer.data.label}, the row is on ${t.accountLabel} — change the payer while the expense is open`,
      ),
    };
  }
  const status = await linking.getAllocationStatus(tx, { type: "expense", id: row.id });
  if (status.error) return { error: status.error };
  const open = new D(status.data?.remaining ?? row.amount.toFixed(2));
  if (open.lte(0)) return { error: violation(`${row.key} is already paid in full`) };
  let amount = parsed.data.amount ? new D(parsed.data.amount) : open;
  if (!parsed.data.amount && t.currency === row.currency) {
    const rowStatus = await linking.getAllocationStatus(tx, { type: "bank_transaction", id: t.id });
    if (rowStatus.error) return { error: rowStatus.error };
    const rowLeft = new D(rowStatus.data?.remaining ?? new D(t.amount).abs().toFixed(2));
    if (rowLeft.lte(0)) {
      return {
        error: violation(`${t.bookingDate} ${t.amount} ${t.currency} has nothing left to allocate`),
      };
    }
    amount = D.min(open, rowLeft);
  }
  if (amount.gt(open)) {
    return {
      error: violation(
        `${amount.toFixed(2)} ${row.currency} exceeds what is open on ${row.key} (${open.toFixed(2)})`,
      ),
    };
  }
  const link = await linking.createLink(
    tx,
    caller,
    audit,
    {
      from: { type: "bank_transaction", id: t.id },
      to: { type: "expense", id: row.id },
      kind: "justifies",
      allocatedAmount: amount.toFixed(2),
      currency: row.currency,
      allocatedBase: parsed.data.amountBase ?? null,
    },
    { owner: "expense" },
  );
  if (link.error) return { error: link.error };
  await audit.log({
    action: "update",
    entityType: "expense",
    entityId: row.id,
    oldData: {},
    newData: {
      paymentLinkId: link.data.id,
      bankTransactionId: t.id,
      allocatedAmount: link.data.allocatedAmount,
      allocatedBase: link.data.allocatedBase,
    },
  });
  return {
    data: {
      ...toExpenseDto(row),
      linkId: link.data.id,
      allocated: link.data.allocatedAmount ?? amount.toFixed(2),
      allocatedBase: link.data.allocatedBase ?? "0.00",
    },
  };
}

/** The reverse: one payment link goes; the expense's money never moved, so nothing is restored. */
export async function unpayExpense(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: UnpayInput,
): Promise<ServiceResult<ExpenseDto>> {
  const parsed = unpaySchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const row = await tx.expense.findUnique({ where: { id: parsed.data.expenseId } });
  if (!row) return { error: notFound("Expense", parsed.data.expenseId) };
  const links = await linking.linksTouching(tx, "expense", [row.id], { kinds: ["justifies"] });
  const link = links.find(
    (l) =>
      l.id === parsed.data.linkId &&
      l.from.type === "bank_transaction" &&
      l.to.type === "expense" &&
      l.to.id === row.id,
  );
  if (!link) return { error: violation(`${row.key} has no such payment`) };
  const removed = await linking.removeLink(tx, caller, audit, link.id, { owner: "expense" });
  if (removed.error) return { error: removed.error };
  await audit.log({
    action: "update",
    entityType: "expense",
    entityId: row.id,
    oldData: {
      paymentLinkId: link.id,
      bankTransactionId: link.from.id,
      allocatedAmount: link.allocatedAmount,
      allocatedBase: link.allocatedBase,
    },
    newData: {},
  });
  return { data: toExpenseDto(row) };
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

/** The owner's private instrument in the base currency — the per-diem is a liability to the owner in SEK (D29). */
async function privateSekPayer(
  tx: TransactionClient,
): Promise<ServiceResult<banking.PayerAccount>> {
  const payer = (await banking.payerAccounts(tx)).find(
    (p) => p.kind === "private" && p.currency === BASE_CURRENCY,
  );
  if (!payer)
    return {
      error: violation(
        `No private ${BASE_CURRENCY} instrument — add one under Banking → Accounts (e.g. "Private SE")`,
      ),
    };
  return { data: payer };
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
  const payer = await privateSekPayer(tx);
  if (payer.error) return { error: payer.error };
  return createExpense(tx, caller, audit, {
    groupId: parsed.data.groupId,
    kind: "per_diem",
    date: parsed.data.date,
    description: parsed.data.description,
    basCode: parsed.data.basCode,
    amount: parsed.data.amount,
    currency: BASE_CURRENCY,
    paidFromAccountId: payer.data.id,
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

/** Whether the expense can still change its money facts (no allocating link onto it) — D37, F114. */
export { isOpen as isExpenseOpen };
