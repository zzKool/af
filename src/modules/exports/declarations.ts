// The declaration record (D23: minimal — the manual refs typed on the form, the figures as declared, declared on /
// paid on, the vat_payment expense). One row per CH registration and quarter, created on first save. Owner only.
// The figures as declared are the server's own computation at the moment of declaring, never what a page sends
// (lesson 2); "paid on" is the attached vat_payment expense's date when there is one (lesson 21).
import { z } from "zod/v4";
import { Prisma, type SwissVatDeclaration } from "@/generated/prisma/client";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { isoDate, uuid } from "@/kernel/validation/scalars";
import * as expenses from "@/modules/expenses";
import * as settings from "@/modules/settings";
import {
  getDeclaration,
  listDeclarations,
  toDeclarationDto,
  withPaymentDate,
} from "./declaration-read";
import { isSwissVatPeriod } from "./period";
import { swissVatReturn } from "./queries";
import { MANUAL_REFS, type SwissVatDeclarationDto } from "./types";

export { getDeclaration, listDeclarations, toDeclarationDto };

const money = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Expected a positive amount with up to two decimals");
const period = z.string().refine(isSwissVatPeriod, "Expected a period like CH 2026/Q2");

export const saveManualSchema = z.object({
  vatRegistrationId: uuid,
  period,
  /** "" clears a ref */
  manual: z.object(
    Object.fromEntries(MANUAL_REFS.map((r) => [r, z.union([money, z.literal("")]).optional()])),
  ),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type SaveManualInput = z.infer<typeof saveManualSchema>;

export const declareSchema = z.object({
  vatRegistrationId: uuid,
  period,
  declaredAt: isoDate,
});
export type DeclareInput = z.infer<typeof declareSchema>;

export const markPaidSchema = z
  .object({
    vatRegistrationId: uuid,
    period,
    /** typed only when no expense paid it; with an expense, paid on is the expense's date (derived) */
    paidAt: isoDate.optional(),
    /** the `vat_payment` expense that paid it */
    paymentExpenseId: uuid.nullable().optional(),
  })
  .refine((v) => !!v.paidAt || !!v.paymentExpenseId, {
    message: "Either the vat_payment expense or the date it was paid",
    path: ["paidAt"],
  });
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

const forbidden: { error: AppError } = {
  error: { code: "FORBIDDEN", message: "Only the owner declares", retryable: false },
};
const violation = (message: string): { error: AppError } => ({
  error: { code: "BUSINESS_RULE_VIOLATION", message, retryable: false },
});

async function assertChRegistration(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string,
): Promise<{ error: AppError } | null> {
  const regs = await settings.getVatRegistrations(tx, caller);
  const reg = regs.data?.find((r) => r.id === id);
  if (!reg)
    return {
      error: { code: "NOT_FOUND", message: "VAT registration not found", retryable: false },
    };
  if (reg.country !== "CH") return violation("The Swiss VAT return needs a CH registration");
  return null;
}

async function upsert(
  tx: TransactionClient,
  caller: CallerIdentity,
  vatRegistrationId: string,
  period: string,
): Promise<SwissVatDeclaration> {
  const existing = await tx.swissVatDeclaration.findFirst({ where: { vatRegistrationId, period } });
  if (existing) return existing;
  return tx.swissVatDeclaration.create({
    data: {
      tenantId: caller.tenantId,
      vatRegistrationId,
      period,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
}

/** The manual refs (and the note) of a quarter — a draft row appears on first save; refused once declared. */
export async function saveManual(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: SaveManualInput,
): Promise<ServiceResult<SwissVatDeclarationDto>> {
  if (!can(caller, "create", "accountant_package")) return forbidden;
  const parsed = saveManualSchema.safeParse(input);
  if (!parsed.success)
    return { error: { code: "VALIDATION_ERROR", message: parsed.error.message, retryable: false } };
  const bad = await assertChRegistration(tx, caller, parsed.data.vatRegistrationId);
  if (bad) return bad;
  const row = await upsert(tx, caller, parsed.data.vatRegistrationId, parsed.data.period);
  if (row.declaredAt) return violation(`${row.period} is declared — the figures are frozen`);
  const manual = Object.fromEntries(
    Object.entries(parsed.data.manual).filter(([, v]) => v !== undefined && v !== ""),
  );
  const updated = await tx.swissVatDeclaration.update({
    where: { id: row.id },
    data: { manual, ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}) },
  });
  await audit.log({
    action: "update",
    entityType: "swiss_vat_declaration",
    entityId: row.id,
    newData: { period: row.period, manual },
  });
  return { data: toDeclarationDto(updated) };
}

/**
 * Declared: the server computes the return of the period now and stores ITS lines as the snapshot — the page
 * sends no figures (lesson 2). From now on every invoice of the period derives "declared".
 */
export async function declare(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: DeclareInput,
): Promise<ServiceResult<SwissVatDeclarationDto>> {
  if (!can(caller, "create", "accountant_package")) return forbidden;
  const parsed = declareSchema.safeParse(input);
  if (!parsed.success)
    return { error: { code: "VALIDATION_ERROR", message: parsed.error.message, retryable: false } };
  const bad = await assertChRegistration(tx, caller, parsed.data.vatRegistrationId);
  if (bad) return bad;
  const row = await upsert(tx, caller, parsed.data.vatRegistrationId, parsed.data.period);
  if (row.declaredAt)
    return violation(`${row.period} is already declared (${iso(row.declaredAt)})`);
  const computed = await swissVatReturn(tx, caller, {
    registrationId: parsed.data.vatRegistrationId,
    period: parsed.data.period,
    today: parsed.data.declaredAt,
  });
  if (computed.error) return { error: computed.error };
  const lines = computed.data.lines;
  const updated = await tx.swissVatDeclaration.update({
    where: { id: row.id },
    data: {
      declaredAt: new Date(`${parsed.data.declaredAt}T00:00:00Z`),
      snapshot: lines as unknown as Prisma.InputJsonValue,
    },
  });
  await audit.log({
    action: "update",
    entityType: "swiss_vat_declaration",
    entityId: row.id,
    newData: {
      period: row.period,
      declaredAt: parsed.data.declaredAt,
      ref500: lines.find((l) => l.ref === "500")?.amount ?? null,
      ref510: lines.find((l) => l.ref === "510")?.amount ?? null,
    },
  });
  return { data: await withPaymentDate(tx, updated) };
}

/** Undo a declaration (nothing was paid yet): the snapshot goes, the figures are live again. */
export async function undeclare(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { vatRegistrationId: string; period: string },
): Promise<ServiceResult<SwissVatDeclarationDto>> {
  if (!can(caller, "create", "accountant_package")) return forbidden;
  const row = await tx.swissVatDeclaration.findFirst({
    where: { vatRegistrationId: input.vatRegistrationId, period: input.period },
  });
  if (!row || !row.declaredAt) return violation(`${input.period} is not declared`);
  if ((await withPaymentDate(tx, row)).paidAt)
    return violation(`${input.period} is paid — undo the payment first`);
  const updated = await tx.swissVatDeclaration.update({
    where: { id: row.id },
    // a payment expense that no longer exists goes with it (paid derives from it, so nothing is lost)
    data: { declaredAt: null, snapshot: Prisma.DbNull, paidAt: null, paymentExpenseId: null },
  });
  await audit.log({
    action: "update",
    entityType: "swiss_vat_declaration",
    entityId: row.id,
    newData: { period: row.period, declaredAt: null },
  });
  return { data: toDeclarationDto(updated) };
}

/**
 * Paid. With the `vat_payment` expense that paid it (validated: exists, is a VAT payment), "paid on" is derived
 * from that expense's date and no date is stored; without one, the typed date is stored.
 */
export async function markPaid(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: MarkPaidInput,
): Promise<ServiceResult<SwissVatDeclarationDto>> {
  if (!can(caller, "create", "accountant_package")) return forbidden;
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success)
    return { error: { code: "VALIDATION_ERROR", message: parsed.error.message, retryable: false } };
  const row = await tx.swissVatDeclaration.findFirst({
    where: { vatRegistrationId: parsed.data.vatRegistrationId, period: parsed.data.period },
  });
  if (!row || !row.declaredAt) return violation(`${parsed.data.period} is not declared yet`);
  const expenseId = parsed.data.paymentExpenseId ?? null;
  if (expenseId) {
    const e = await expenses.getExpenseDetail(tx, expenseId);
    if (!e.data)
      return { error: { code: "NOT_FOUND", message: "Expense not found", retryable: false } };
    if (e.data.expense.kind !== "vat_payment")
      return violation(`${e.data.expense.key} is not a VAT payment`);
  }
  const typed = expenseId ? null : (parsed.data.paidAt ?? null);
  const updated = await tx.swissVatDeclaration.update({
    where: { id: row.id },
    data: {
      paidAt: typed ? new Date(`${typed}T00:00:00Z`) : null,
      paymentExpenseId: expenseId,
    },
  });
  const dto = await withPaymentDate(tx, updated);
  await audit.log({
    action: "update",
    entityType: "swiss_vat_declaration",
    entityId: row.id,
    newData: { period: row.period, paidAt: dto.paidAt, paymentExpenseId: expenseId },
  });
  return { data: dto };
}

export async function unmarkPaid(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { vatRegistrationId: string; period: string },
): Promise<ServiceResult<SwissVatDeclarationDto>> {
  if (!can(caller, "create", "accountant_package")) return forbidden;
  const row = await tx.swissVatDeclaration.findFirst({
    where: { vatRegistrationId: input.vatRegistrationId, period: input.period },
  });
  if (!row || (!row.paidAt && !row.paymentExpenseId))
    return violation(`${input.period} is not marked paid`);
  const updated = await tx.swissVatDeclaration.update({
    where: { id: row.id },
    data: { paidAt: null, paymentExpenseId: null },
  });
  await audit.log({
    action: "update",
    entityType: "swiss_vat_declaration",
    entityId: row.id,
    newData: { period: row.period, paidAt: null },
  });
  return { data: toDeclarationDto(updated) };
}
