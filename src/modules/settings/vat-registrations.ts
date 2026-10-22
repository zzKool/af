import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

// Validates rate schedule shape: array of 1-10 percentage numbers (0-100)
// No country exceeds 6 tiers — cap at 10 defensively
export const rateScheduleSchema = z
  .object({
    rates: z.array(z.number().min(0).max(100)).min(1).max(10),
  })
  .strict();

export type RateSchedule = z.infer<typeof rateScheduleSchema>;

/** The `rate_schedule` JSONB column as Prisma writes it. */
function rateScheduleToJson(schedule: RateSchedule): Prisma.InputJsonObject {
  return { ...schedule };
}

/** The stored `rate_schedule`, or null when there is none or it does not read as a schedule (never cast, lesson 29). */
export function parseRateSchedule(value: unknown): RateSchedule | null {
  if (value === null || value === undefined) return null;
  const parsed = rateScheduleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type VatRegistrationDto = {
  id: string;
  country: string;
  vatNumber: string;
  rateSchedule: RateSchedule | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Get all VAT registrations for the tenant (RLS-scoped by middleware).
 * Read-only — no audit param needed.
 */
export async function getVatRegistrations(
  tx: TransactionClient,
  _caller: CallerIdentity,
): Promise<ServiceResult<VatRegistrationDto[]>> {
  const registrations = await tx.vatRegistration.findMany({
    orderBy: [{ country: "asc" }, { vatNumber: "asc" }],
  });
  return {
    data: registrations.map((r) => ({
      id: r.id,
      country: r.country,
      vatNumber: r.vatNumber,
      rateSchedule: parseRateSchedule(r.rateSchedule),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
}

// --- usage (lesson 19) ---

/** The modules that keep a registration's id on their rows; each counts its own (constitution §2). */
export const VAT_REGISTRATION_USERS = ["invoices", "declarations"] as const;
export type VatRegistrationUser = (typeof VAT_REGISTRATION_USERS)[number];

/** Hook: how many rows of one module carry this registration. Wired by the composition root (src/instrumentation.ts). */
export type VatRegistrationUsage = (
  tx: TransactionClient,
  registrationId: string,
) => Promise<number>;
const usage = new Map<VatRegistrationUser, VatRegistrationUsage>();
export function setVatRegistrationUsage(user: VatRegistrationUser, fn: VatRegistrationUsage): void {
  usage.set(user, fn);
}

/**
 * Create a new VAT registration for the tenant.
 * Validates country (2-char uppercase) and rate schedule shape.
 * Catches Prisma P2002 for duplicate country+vatNumber → DUPLICATE_ENTRY.
 */
export async function createVatRegistration(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { country: string; vatNumber: string; rateSchedule?: RateSchedule },
): Promise<ServiceResult<{ id: string }>> {
  // Validate country: exactly 2 uppercase ASCII letters
  if (!/^[A-Z]{2}$/.test(input.country)) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "Country must be a 2-character uppercase ISO 3166-1 alpha-2 code",
        retryable: false,
      },
    };
  }

  // Validate rate schedule if provided
  if (input.rateSchedule !== undefined) {
    const result = rateScheduleSchema.safeParse(input.rateSchedule);
    if (!result.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid rate schedule: must have 1-10 rates between 0 and 100",
          retryable: false,
        },
      };
    }
  }

  try {
    const registration = await tx.vatRegistration.create({
      data: {
        tenantId: caller.tenantId,
        country: input.country,
        vatNumber: input.vatNumber,
        rateSchedule: input.rateSchedule ? rateScheduleToJson(input.rateSchedule) : undefined,
        createdBy: caller.userId,
        source: caller.source,
      },
    });

    await audit.log({
      action: "create",
      entityType: "vat_registration",
      entityId: registration.id,
      newData: toAuditData(registration),
    });

    return { data: { id: registration.id } };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: `A VAT registration with this country and number already exists`,
          retryable: false,
        },
      };
    }
    throw error;
  }
}

/**
 * Update an existing VAT registration.
 * Country is immutable after creation — only vatNumber and rateSchedule can change.
 * Read-before-write for audit oldData/newData.
 */
export async function updateVatRegistration(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: { vatNumber?: string; rateSchedule?: RateSchedule | null },
): Promise<ServiceResult<{ updated: boolean }>> {
  // Validate rate schedule if provided (null clears it)
  if (input.rateSchedule !== undefined && input.rateSchedule !== null) {
    const result = rateScheduleSchema.safeParse(input.rateSchedule);
    if (!result.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid rate schedule: must have 1-10 rates between 0 and 100",
          retryable: false,
        },
      };
    }
  }

  const existing = await tx.vatRegistration.findUnique({ where: { id } });
  if (!existing) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `VAT registration not found: ${id}`,
        retryable: false,
      },
    };
  }

  const updateData: Prisma.VatRegistrationUncheckedUpdateInput = {};
  if (input.vatNumber !== undefined) updateData.vatNumber = input.vatNumber;
  if (input.rateSchedule !== undefined) {
    updateData.rateSchedule =
      input.rateSchedule === null ? Prisma.DbNull : rateScheduleToJson(input.rateSchedule);
  }

  try {
    const updated = await tx.vatRegistration.update({
      where: { id },
      data: updateData,
    });

    await audit.log({
      action: "update",
      entityType: "vat_registration",
      entityId: id,
      oldData: toAuditData(existing),
      newData: toAuditData(updated),
    });

    return { data: { updated: true } };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: `A VAT registration with this country and number already exists`,
          retryable: false,
        },
      };
    }
    throw error;
  }
}

/**
 * Delete a VAT registration — refused while an invoice or a declaration carries its id (lesson 19), else their
 * VAT treatment and the quarter's return would point at nothing. Read-before-delete for audit oldData.
 */
export async function deleteVatRegistration(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: boolean }>> {
  const existing = await tx.vatRegistration.findUnique({ where: { id } });
  if (!existing) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `VAT registration not found: ${id}`,
        retryable: false,
      },
    };
  }

  const counts: Record<VatRegistrationUser, number> = { invoices: 0, declarations: 0 };
  for (const [user, count] of usage) counts[user] = await count(tx, id);
  if (counts.invoices > 0 || counts.declarations > 0) {
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message: `This VAT registration is used by ${counts.invoices} invoice(s) and ${counts.declarations} declaration(s) and cannot be deleted`,
        retryable: false,
        details: counts,
      },
    };
  }

  await tx.vatRegistration.delete({ where: { id } });

  await audit.log({
    action: "delete",
    entityType: "vat_registration",
    entityId: id,
    oldData: toAuditData(existing),
  });

  return { data: { deleted: true } };
}
