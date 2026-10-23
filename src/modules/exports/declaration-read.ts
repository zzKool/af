// The declaration record, read side: the row → DTO with its JSON columns parsed (never cast, lesson 29) and
// "paid on" derived from the `vat_payment` expense when one is attached (lesson 21) — the typed date is used only
// when no expense paid it. Split from ./declarations so the write side may call the return (./queries) without a
// cycle: queries → declaration-read ← declarations → queries.
import { z } from "zod/v4";
import type { Prisma, SwissVatDeclaration } from "@/generated/prisma/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as expenses from "@/modules/expenses";
import {
  MANUAL_REFS,
  type ManualRefs,
  SWISS_VAT_REFS,
  type SwissVatDeclarationDto,
  type SwissVatLine,
} from "./types";

const decimal = z.string().regex(/^-?\d{1,13}(\.\d{1,2})?$/);

const lineSchema = z.object({
  ref: z.enum(SWISS_VAT_REFS),
  section: z.enum(["I", "II", "II-bis", "III"]),
  labelFr: z.string(),
  labelEn: z.string(),
  source: z.enum(["auto", "calc", "manual", "zero"]),
  amount: decimal,
  base: decimal.optional(),
  rate: z.string().optional(),
});
const snapshotSchema = z.array(lineSchema).min(1);
const manualSchema = z.partialRecord(z.enum(MANUAL_REFS), decimal);

/** The stored snapshot, or null when there is none or it does not read as a form (a legacy, hand-made one). */
export function parseSnapshot(value: unknown): SwissVatLine[] | null {
  if (value === null || value === undefined) return null;
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? (parsed.data as SwissVatLine[]) : null;
}

/** The write side of `parseSnapshot`: the lines as Prisma JSON, the optional keys only when present — no cast. */
export function snapshotToJson(lines: readonly SwissVatLine[]): Prisma.InputJsonArray {
  return lines.map((l) => ({
    ref: l.ref,
    section: l.section,
    labelFr: l.labelFr,
    labelEn: l.labelEn,
    source: l.source,
    amount: l.amount,
    ...(l.base !== undefined ? { base: l.base } : {}),
    ...(l.rate !== undefined ? { rate: l.rate } : {}),
  }));
}

export function parseManual(value: unknown): ManualRefs {
  const parsed = manualSchema.safeParse(value ?? {});
  return parsed.success ? (parsed.data as ManualRefs) : {};
}

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * The DTO of a row. `paymentDate` is the date of the attached `vat_payment` expense (see `paymentDates`):
 * with an expense attached, paid on = that date (null if the expense is gone); without one, the typed date.
 */
export function toDeclarationDto(
  row: SwissVatDeclaration,
  paymentDate: string | null = null,
): SwissVatDeclarationDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    vatRegistrationId: row.vatRegistrationId,
    period: row.period,
    manual: parseManual(row.manual),
    snapshot: parseSnapshot(row.snapshot),
    declaredAt: iso(row.declaredAt),
    paidAt: row.paymentExpenseId ? paymentDate : iso(row.paidAt),
    paymentExpenseId: row.paymentExpenseId,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

/** The date of each attached `vat_payment` expense (missing ids are absent from the map). */
export async function paymentDates(
  tx: TransactionClient,
  expenseIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(expenseIds.filter((id): id is string => !!id))];
  const out = new Map<string, string>();
  for (const id of ids) {
    const e = await expenses.getExpenseDetail(tx, id);
    if (e.data) out.set(id, e.data.expense.date);
  }
  return out;
}

export async function withPaymentDate(
  tx: TransactionClient,
  row: SwissVatDeclaration,
): Promise<SwissVatDeclarationDto> {
  const dates = await paymentDates(tx, [row.paymentExpenseId]);
  return toDeclarationDto(
    row,
    row.paymentExpenseId ? (dates.get(row.paymentExpenseId) ?? null) : null,
  );
}

export async function getDeclaration(
  tx: TransactionClient,
  vatRegistrationId: string,
  period: string,
): Promise<SwissVatDeclarationDto | null> {
  const row = await tx.swissVatDeclaration.findFirst({ where: { vatRegistrationId, period } });
  return row ? withPaymentDate(tx, row) : null;
}

/** Every declaration, newest period first — "declared" on an invoice is derived from this set. */
export async function listDeclarations(tx: TransactionClient): Promise<SwissVatDeclarationDto[]> {
  const rows = await tx.swissVatDeclaration.findMany({ orderBy: [{ period: "desc" }] });
  const dates = await paymentDates(
    tx,
    rows.map((r) => r.paymentExpenseId),
  );
  return rows.map((r) =>
    toDeclarationDto(r, r.paymentExpenseId ? (dates.get(r.paymentExpenseId) ?? null) : null),
  );
}
