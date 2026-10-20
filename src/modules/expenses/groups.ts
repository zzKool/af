// Expense groups (FR-001): `213 — Travel to CH in March 2026`, the folder a receipt goes into. The number comes from
// number_series `expense_group` and is never reused; a group with expenses is never deleted.
// MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import type { ExpenseGroup } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { nextInSeries } from "@/modules/numbering";
import { invalid, notFound, violation } from "./errors";
import { EXPENSE_GROUP_KINDS, type ExpenseGroupDto, type ExpenseGroupKind } from "./types";

export const EXPENSE_GROUP_SERIES = "expense_group";

export const groupInputSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(200),
  kind: z.enum(EXPENSE_GROUP_KINDS).optional(),
});
export type GroupInput = z.input<typeof groupInputSchema>;

export const updateGroupSchema = groupInputSchema.partial();
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;

export function toGroupDto(row: ExpenseGroup): ExpenseGroupDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    number: row.number,
    description: row.description,
    kind: row.kind as ExpenseGroupKind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

/** `213 — Travel to CH in March 2026` */
export function groupLabel(g: { number: number; description: string }): string {
  return `${g.number} — ${g.description}`;
}

export async function createGroup(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: GroupInput,
): Promise<ServiceResult<ExpenseGroupDto>> {
  const parsed = groupInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const number = await nextInSeries(tx, caller, EXPENSE_GROUP_SERIES);
  const row = await tx.expenseGroup.create({
    data: {
      tenantId: caller.tenantId,
      number,
      description: parsed.data.description,
      kind: parsed.data.kind ?? "batch",
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "expense_group",
    entityId: row.id,
    newData: toAuditData(row),
  });
  return { data: toGroupDto(row) };
}

export async function updateGroup(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: UpdateGroupInput,
): Promise<ServiceResult<ExpenseGroupDto>> {
  const parsed = updateGroupSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const row = await tx.expenseGroup.findUnique({ where: { id }, include: { trip: true } });
  if (!row) return { error: notFound("Expense group", id) };
  if (parsed.data.kind && parsed.data.kind !== row.kind && row.trip) {
    return { error: violation("A group with a trip stays a trip group") };
  }
  const updated = await tx.expenseGroup.update({
    where: { id },
    data: {
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
    },
  });
  await audit.log({
    action: "update",
    entityType: "expense_group",
    entityId: id,
    oldData: { description: row.description, kind: row.kind },
    newData: { description: updated.description, kind: updated.kind },
  });
  return { data: toGroupDto(updated) };
}

export async function deleteGroup(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: true }>> {
  const row = await tx.expenseGroup.findUnique({
    where: { id },
    include: { _count: { select: { expenses: true } } },
  });
  if (!row) return { error: notFound("Expense group", id) };
  if (row._count.expenses > 0) {
    return {
      error: violation(
        `Group ${row.number} has ${row._count.expenses} expense(s) — move or delete them first`,
      ),
    };
  }
  await tx.expenseGroup.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "expense_group",
    entityId: id,
    oldData: toAuditData(row),
  });
  return { data: { deleted: true } };
}

export async function getGroup(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<ExpenseGroupDto>> {
  const row = await tx.expenseGroup.findUnique({ where: { id } });
  if (!row) return { error: notFound("Expense group", id) };
  return { data: toGroupDto(row) };
}
