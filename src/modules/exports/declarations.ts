// The declaration record (D23: minimal — the manual refs typed on the form, the figures as declared, declared on /
// paid on, the vat_payment expense). One row per CH registration and quarter, created on first save. Owner only.
import { z } from "zod/v4";
import { Prisma, type SwissVatDeclaration } from "@/generated/prisma/client";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import * as expenses from "@/modules/expenses";
import * as settings from "@/modules/settings";
import { isSwissVatPeriod } from "./swiss-vat";
import {
  MANUAL_REFS,
  type ManualRefs,
  type SwissVatDeclarationDto,
  type SwissVatLine,
} from "./types";

const uuid = z.string().uuid();
const money = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Expected a positive amount with up to two decimals");
const isoDate = z.string().date();
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
  /** the computed lines at this moment — the page sends what it shows; stored as the snapshot */
  lines: z.array(
    z.object({
      ref: z.string(),
      section: z.enum(["I", "II", "II-bis", "III"]),
      labelFr: z.string(),
      labelEn: z.string(),
      source: z.enum(["auto", "calc", "manual", "zero"]),
      amount: z.string(),
      base: z.string().optional(),
      rate: z.string().optional(),
    }),
  ),
});
export type DeclareInput = z.infer<typeof declareSchema>;

export const markPaidSchema = z.object({
  vatRegistrationId: uuid,
  period,
  paidAt: isoDate,
  /** the `vat_payment` expense that paid it (optional) */
  paymentExpenseId: uuid.nullable().optional(),
});
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function toDeclarationDto(row: SwissVatDeclaration): SwissVatDeclarationDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    vatRegistrationId: row.vatRegistrationId,
    period: row.period,
    manual: (row.manual ?? {}) as ManualRefs,
    snapshot: (row.snapshot as SwissVatLine[] | null) ?? null,
    declaredAt: iso(row.declaredAt),
    paidAt: iso(row.paidAt),
    paymentExpenseId: row.paymentExpenseId,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

const forbidden: { error: AppError } = {
  error: { code: "FORBIDDEN", message: "Only the owner declares", retryable: false },
};
const violation = (message: string): { error: AppError } => ({
  error: { code: "BUSINESS_RULE_VIOLATION", message, retryable: false },
});

export async function getDeclaration(
  tx: TransactionClient,
  vatRegistrationId: string,
  period: string,
): Promise<SwissVatDeclarationDto | null> {
  const row = await tx.swissVatDeclaration.findFirst({ where: { vatRegistrationId, period } });
  return row ? toDeclarationDto(row) : null;
}

/** Every declaration, newest period first — "declared" on an invoice is derived from this set. */
export async function listDeclarations(tx: TransactionClient): Promise<SwissVatDeclarationDto[]> {
  const rows = await tx.swissVatDeclaration.findMany({ orderBy: [{ period: "desc" }] });
  return rows.map(toDeclarationDto);
}

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

/** Declared: the lines as shown become the snapshot; from now on every invoice of the period derives "declared". */
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
  const updated = await tx.swissVatDeclaration.update({
    where: { id: row.id },
    data: {
      declaredAt: new Date(`${parsed.data.declaredAt}T00:00:00Z`),
      snapshot: parsed.data.lines,
    },
  });
  await audit.log({
    action: "update",
    entityType: "swiss_vat_declaration",
    entityId: row.id,
    newData: {
      period: row.period,
      declaredAt: parsed.data.declaredAt,
      ref500: parsed.data.lines.find((l) => l.ref === "500")?.amount ?? null,
      ref510: parsed.data.lines.find((l) => l.ref === "510")?.amount ?? null,
    },
  });
  return { data: toDeclarationDto(updated) };
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
  if (row.paidAt) return violation(`${input.period} is paid — undo the payment first`);
  const updated = await tx.swissVatDeclaration.update({
    where: { id: row.id },
    data: { declaredAt: null, snapshot: Prisma.DbNull },
  });
  await audit.log({
    action: "update",
    entityType: "swiss_vat_declaration",
    entityId: row.id,
    newData: { period: row.period, declaredAt: null },
  });
  return { data: toDeclarationDto(updated) };
}

/** Paid: the date and, when given, the `vat_payment` expense that paid it (validated: exists, is a VAT payment). */
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
  if (parsed.data.paymentExpenseId) {
    const e = await expenses.getExpenseDetail(tx, parsed.data.paymentExpenseId);
    if (!e.data)
      return { error: { code: "NOT_FOUND", message: "Expense not found", retryable: false } };
    if (e.data.expense.kind !== "vat_payment")
      return violation(`${e.data.expense.key} is not a VAT payment`);
  }
  const updated = await tx.swissVatDeclaration.update({
    where: { id: row.id },
    data: {
      paidAt: new Date(`${parsed.data.paidAt}T00:00:00Z`),
      paymentExpenseId: parsed.data.paymentExpenseId ?? null,
    },
  });
  await audit.log({
    action: "update",
    entityType: "swiss_vat_declaration",
    entityId: row.id,
    newData: {
      period: row.period,
      paidAt: parsed.data.paidAt,
      paymentExpenseId: parsed.data.paymentExpenseId ?? null,
    },
  });
  return { data: toDeclarationDto(updated) };
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
  if (!row || !row.paidAt) return violation(`${input.period} is not marked paid`);
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
