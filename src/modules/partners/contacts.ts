// Contact persons of a partner (F08, specs/partners/spec.md): name, role, e-mail, phone.
// Not linkable; deleted with the partner (intra-module FK). Every write is audited.
import { z } from "zod/v4";
import type { PartnerContact } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import type { PartnerContactDto } from "./types";

// MUST NOT import from next/* or src/components/*

// --- Zod Schemas ---

/** Trimmed; "" → null; undefined stays undefined (an update leaves the field as it is). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));

const nameSchema = z.string().trim().min(1, "Name is required").max(200);

const emailSchema = optionalText(254).refine(
  (v) => v == null || z.email().safeParse(v).success,
  "Not a valid e-mail address",
);

export const createPartnerContactSchema = z.object({
  partnerId: z.string().uuid(),
  name: nameSchema,
  role: optionalText(100),
  email: emailSchema,
  phone: optionalText(50),
});

export const updatePartnerContactSchema = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  role: optionalText(100),
  email: emailSchema,
  phone: optionalText(50),
});

export type CreatePartnerContactInput = z.input<typeof createPartnerContactSchema>;
export type UpdatePartnerContactInput = z.input<typeof updatePartnerContactSchema>;

// --- Helpers ---

function invalid(error: z.ZodError): AppError {
  const issue = error.issues[0];
  return {
    code: "VALIDATION_ERROR",
    message: issue?.message ?? "Invalid contact",
    retryable: false,
    details: { field: String(issue?.path[0] ?? "") },
  };
}

function notFound(what: string, id: string): AppError {
  return { code: "NOT_FOUND", message: `${what} not found: ${id}`, retryable: false };
}

export function toPartnerContactDto(row: PartnerContact): PartnerContactDto {
  return {
    id: row.id,
    partnerId: row.partnerId,
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Case-insensitive by name, then the oldest first so equal names keep their order. */
function byName(a: PartnerContactDto, b: PartnerContactDto): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}

// --- Reads ---

export async function listPartnerContacts(
  tx: TransactionClient,
  partnerId: string,
): Promise<ServiceResult<PartnerContactDto[]>> {
  const rows = await tx.partnerContact.findMany({ where: { partnerId } });
  return { data: rows.map(toPartnerContactDto).sort(byName) };
}

// --- Writes ---

export async function createPartnerContact(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: CreatePartnerContactInput,
): Promise<ServiceResult<PartnerContactDto>> {
  const parsed = createPartnerContactSchema.safeParse(input);
  if (!parsed.success) return { error: invalid(parsed.error) };
  const data = parsed.data;

  // RLS: a partner of another tenant is invisible, hence not found
  const partner = await tx.partner.findUnique({
    where: { id: data.partnerId },
    select: { id: true },
  });
  if (!partner) return { error: notFound("Partner", data.partnerId) };

  const row = await tx.partnerContact.create({
    data: {
      tenantId: caller.tenantId,
      partnerId: data.partnerId,
      name: data.name,
      role: data.role ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  const dto = toPartnerContactDto(row);
  await audit.log({
    action: "create",
    entityType: "partner_contact",
    entityId: row.id,
    newData: toAuditData(dto),
  });
  return { data: dto };
}

export async function updatePartnerContact(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  input: UpdatePartnerContactInput,
): Promise<ServiceResult<PartnerContactDto>> {
  const parsed = updatePartnerContactSchema.safeParse(input);
  if (!parsed.success) return { error: invalid(parsed.error) };
  const { id, ...changes } = parsed.data;

  const existing = await tx.partnerContact.findUnique({ where: { id } });
  if (!existing) return { error: notFound("Contact", id) };

  // an undefined field is left as it is (Prisma skips it); null clears it
  const row = await tx.partnerContact.update({ where: { id }, data: changes });
  const dto = toPartnerContactDto(row);
  await audit.log({
    action: "update",
    entityType: "partner_contact",
    entityId: id,
    oldData: toAuditData(toPartnerContactDto(existing)),
    newData: toAuditData(dto),
  });
  return { data: dto };
}

export async function deletePartnerContact(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ id: string }>> {
  const existing = await tx.partnerContact.findUnique({ where: { id } });
  if (!existing) return { error: notFound("Contact", id) };
  await tx.partnerContact.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "partner_contact",
    entityId: id,
    oldData: toAuditData(toPartnerContactDto(existing)),
  });
  return { data: { id } };
}
