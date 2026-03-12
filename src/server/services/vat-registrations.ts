import { z } from "zod/v4";
import type { TransactionClient } from "@/server/db/tenant-client";
import { toAuditData } from "@/server/services/audit";
import type { AppError } from "@/types/app-error";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";

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

/**
 * Get all VAT registrations for the tenant (RLS-scoped by middleware).
 * Read-only — no audit param needed.
 */
export async function getVatRegistrations(
  tx: TransactionClient,
  _caller: CallerIdentity,
): Promise<
  ServiceResult<
    {
      id: string;
      country: string;
      vatNumber: string;
      rateSchedule: unknown;
      createdAt: Date;
      updatedAt: Date;
    }[]
  >
> {
  const registrations = await tx.vatRegistration.findMany({
    orderBy: [{ country: "asc" }, { vatNumber: "asc" }],
  });
  return { data: registrations };
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
        // biome-ignore lint/suspicious/noExplicitAny: Prisma's InputJsonValue is too narrow for our JSONB shape
        rateSchedule: (input.rateSchedule as any) ?? undefined,
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

  const updateData: Record<string, unknown> = {};
  if (input.vatNumber !== undefined) updateData.vatNumber = input.vatNumber;
  if (input.rateSchedule !== undefined) {
    // biome-ignore lint/suspicious/noExplicitAny: Prisma's InputJsonValue is too narrow for our JSONB shape
    updateData.rateSchedule = input.rateSchedule as any;
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
 * Delete a VAT registration.
 * Read-before-delete for audit oldData.
 */
export async function deleteVatRegistration(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: boolean }>> {
  // TODO: Epic 4/10 — check for partner/invoice/contract references before allowing delete
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

  await tx.vatRegistration.delete({ where: { id } });

  await audit.log({
    action: "delete",
    entityType: "vat_registration",
    entityId: id,
    oldData: toAuditData(existing),
  });

  return { data: { deleted: true } };
}
