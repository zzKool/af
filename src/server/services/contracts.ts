import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/server/db/tenant-client";
import { toAuditData } from "@/server/services/audit";
import type { AppError } from "@/types/app-error";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

// --- Zod Schemas ---

const externalReferenceSchema = z.object({
  label: z.string().min(1).max(50),
  value: z.string().min(1).max(100),
});

const contractBaseSchema = z.object({
  partnerId: z.string().uuid(),
  name: z.string().min(1).max(200),
  startDate: z.string().date(), // ISO date string "YYYY-MM-DD"
  endDate: z.string().date().optional(),
  assignedEmployeeId: z.string().uuid().optional(),
  billingRate: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid rate format — use digits with up to 2 decimal places")
    .refine((v) => Number.parseFloat(v) >= 0, "Rate must be non-negative")
    .optional(),
  currency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
  paymentTerms: z.string().max(50).optional(),
  vatRegistrationId: z.string().uuid().optional(),
  externalReferences: z.array(externalReferenceSchema).max(5).default([]),
});

export const createContractSchema = contractBaseSchema.refine(
  (data) => !data.endDate || data.startDate <= data.endDate,
  {
    message: "End date must be after start date",
    path: ["endDate"],
  },
);

export const updateContractSchema = contractBaseSchema
  .partial()
  .omit({ partnerId: true })
  .extend({
    id: z.string().uuid(),
  })
  .refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  });

export type CreateContractInput = z.input<typeof createContractSchema>;
export type UpdateContractInput = z.input<typeof updateContractSchema>;

// --- Service Functions ---

export async function getContracts(
  tx: TransactionClient,
  partnerId: string,
  options?: { includeInactive?: boolean },
): Promise<ServiceResult<Awaited<ReturnType<typeof tx.contract.findMany>>>> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic where clause construction
  const where: any = { partnerId };
  if (!options?.includeInactive) {
    where.isActive = true;
  }
  const contracts = await tx.contract.findMany({
    where,
    orderBy: { startDate: "desc" },
  });
  return { data: contracts };
}

export async function getContract(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<Awaited<ReturnType<typeof tx.contract.findUnique>>>> {
  const contract = await tx.contract.findUnique({ where: { id } });
  if (!contract) {
    return { error: { code: "NOT_FOUND", message: `Contract not found: ${id}`, retryable: false } };
  }
  return { data: contract };
}

export async function createContract(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  data: CreateContractInput,
): Promise<ServiceResult<{ id: string }>> {
  // Validate partner exists, is active, and has client type
  const partner = await tx.partner.findUnique({ where: { id: data.partnerId } });
  if (!partner) {
    return { error: { code: "NOT_FOUND", message: "Partner not found", retryable: false } };
  }
  if (!partner.isActive) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "Cannot create contracts for inactive partners",
        retryable: false,
      },
    };
  }
  if (!partner.types.includes("client")) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "Partner must have client type to create contracts",
        retryable: false,
      },
    };
  }

  // Validate assigned employee if provided
  if (data.assignedEmployeeId) {
    const employee = await tx.partner.findUnique({ where: { id: data.assignedEmployeeId } });
    if (!employee) {
      return {
        error: { code: "NOT_FOUND", message: "Assigned employee not found", retryable: false },
      };
    }
    if (!employee.types.includes("employee")) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Assigned partner must have employee type",
          retryable: false,
        },
      };
    }
  }

  // Validate VAT registration if provided (RLS-scoped, so tenant-safe)
  if (data.vatRegistrationId) {
    const vatReg = await tx.vatRegistration.findUnique({ where: { id: data.vatRegistrationId } });
    if (!vatReg) {
      return {
        error: { code: "NOT_FOUND", message: "VAT registration not found", retryable: false },
      };
    }
  }

  // Validate billing rate if provided
  if (data.billingRate !== undefined) {
    const rateResult = z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((v) => Number.parseFloat(v) >= 0)
      .safeParse(data.billingRate);
    if (!rateResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid billing rate format",
          retryable: false,
        },
      };
    }
  }

  // Validate date range
  if (data.endDate && data.startDate > data.endDate) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "End date must be after start date",
        retryable: false,
      },
    };
  }

  // Validate external references shape
  if (data.externalReferences && data.externalReferences.length > 0) {
    const erResult = z.array(externalReferenceSchema).max(5).safeParse(data.externalReferences);
    if (!erResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid external references",
          retryable: false,
        },
      };
    }
  }

  const contract = await tx.contract.create({
    data: {
      tenantId: caller.tenantId,
      name: data.name,
      partnerId: data.partnerId,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : null,
      assignedEmployeeId: data.assignedEmployeeId || null,
      billingRate: data.billingRate ? new Prisma.Decimal(data.billingRate) : null,
      currency: data.currency || null,
      paymentTerms: data.paymentTerms || null,
      vatRegistrationId: data.vatRegistrationId || null,
      // biome-ignore lint/suspicious/noExplicitAny: Prisma's InputJsonValue is too narrow for our JSONB shape
      externalReferences: (data.externalReferences ?? []) as any,
      createdBy: caller.userId,
      source: caller.source,
    },
  });

  await audit.log({
    action: "create",
    entityType: "contract",
    entityId: contract.id,
    newData: toAuditData(contract),
  });

  return { data: { id: contract.id } };
}

export async function updateContract(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  data: Omit<UpdateContractInput, "id">,
): Promise<ServiceResult<{ updated: boolean }>> {
  const existing = await tx.contract.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Contract not found: ${id}`, retryable: false } };
  }

  // Validate assigned employee if changed
  if (data.assignedEmployeeId !== undefined && data.assignedEmployeeId !== null) {
    const employee = await tx.partner.findUnique({ where: { id: data.assignedEmployeeId } });
    if (!employee) {
      return {
        error: { code: "NOT_FOUND", message: "Assigned employee not found", retryable: false },
      };
    }
    if (!employee.types.includes("employee")) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Assigned partner must have employee type",
          retryable: false,
        },
      };
    }
  }

  // Validate VAT registration if changed
  if (data.vatRegistrationId !== undefined && data.vatRegistrationId !== null) {
    const vatReg = await tx.vatRegistration.findUnique({ where: { id: data.vatRegistrationId } });
    if (!vatReg) {
      return {
        error: { code: "NOT_FOUND", message: "VAT registration not found", retryable: false },
      };
    }
  }

  // Validate billing rate if provided
  if (data.billingRate !== undefined && data.billingRate !== null) {
    const rateResult = z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((v) => Number.parseFloat(v) >= 0)
      .safeParse(data.billingRate);
    if (!rateResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid billing rate format",
          retryable: false,
        },
      };
    }
  }

  // Validate date range if dates are changing
  const startDate = data.startDate ?? existing.startDate.toISOString().split("T")[0];
  const endDate =
    data.endDate !== undefined ? data.endDate : existing.endDate?.toISOString().split("T")[0];
  if (endDate && startDate > endDate) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "End date must be after start date",
        retryable: false,
      },
    };
  }

  // Validate external references if provided
  if (data.externalReferences !== undefined) {
    const erResult = z.array(externalReferenceSchema).max(5).safeParse(data.externalReferences);
    if (!erResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid external references",
          retryable: false,
        },
      };
    }
  }

  // Build update data — only include provided fields
  // biome-ignore lint/suspicious/noExplicitAny: dynamic update data construction
  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
  if (data.assignedEmployeeId !== undefined)
    updateData.assignedEmployeeId = data.assignedEmployeeId || null;
  if (data.billingRate !== undefined)
    updateData.billingRate = data.billingRate ? new Prisma.Decimal(data.billingRate) : null;
  if (data.currency !== undefined) updateData.currency = data.currency || null;
  if (data.paymentTerms !== undefined) updateData.paymentTerms = data.paymentTerms || null;
  if (data.vatRegistrationId !== undefined)
    updateData.vatRegistrationId = data.vatRegistrationId || null;
  if (data.externalReferences !== undefined)
    updateData.externalReferences = data.externalReferences;

  const updated = await tx.contract.update({
    where: { id },
    data: updateData,
  });

  await audit.log({
    action: "update",
    entityType: "contract",
    entityId: id,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { updated: true } };
}

export async function deactivateContract(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deactivated: boolean }>> {
  const existing = await tx.contract.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Contract not found: ${id}`, retryable: false } };
  }
  if (!existing.isActive) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "Contract is already inactive",
        retryable: false,
      },
    };
  }

  const updated = await tx.contract.update({
    where: { id },
    data: { isActive: false },
  });

  await audit.log({
    action: "deactivate",
    entityType: "contract",
    entityId: id,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { deactivated: true } };
}

export async function reactivateContract(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ reactivated: boolean }>> {
  const existing = await tx.contract.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Contract not found: ${id}`, retryable: false } };
  }
  if (existing.isActive) {
    return {
      error: { code: "VALIDATION_ERROR", message: "Contract is already active", retryable: false },
    };
  }

  const updated = await tx.contract.update({
    where: { id },
    data: { isActive: true },
  });

  await audit.log({
    action: "reactivate",
    entityType: "contract",
    entityId: id,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { reactivated: true } };
}
