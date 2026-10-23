import { z } from "zod/v4";
import type { Contract, Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { isoDate, uuid } from "@/kernel/validation/scalars";
import { currentRatesFor } from "./contract-rates";
import type { ContractDto, CurrentRate, ExternalReference } from "./types";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

// --- Zod Schemas ---

const externalReferenceSchema = z.object({
  label: z.string().min(1).max(50),
  value: z.string().min(1).max(100),
});

const contractBaseSchema = z.object({
  partnerId: uuid,
  name: z.string().min(1).max(200),
  startDate: isoDate, // ISO date string "YYYY-MM-DD"
  endDate: isoDate.optional(),
  assignedEmployeeId: uuid.optional(),
  currency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
  paymentTerms: z.string().max(50).optional(),
  vatRegistrationId: uuid.optional(),
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
    id: uuid,
  })
  .refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  });

export type CreateContractInput = z.input<typeof createContractSchema>;
export type UpdateContractInput = z.input<typeof updateContractSchema>;

// --- JSON column (`external_references`) — typed once, both ways ---

function isExternalReference(v: unknown): v is ExternalReference {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "label" in v &&
    typeof v.label === "string" &&
    "value" in v &&
    typeof v.value === "string"
  );
}

function toReferences(json: Prisma.JsonValue): ExternalReference[] {
  return Array.isArray(json) ? json.filter(isExternalReference) : [];
}

function referencesToJson(refs: ExternalReference[]): Prisma.InputJsonArray {
  return refs.map((r) => ({ ...r }));
}

// --- DTO mapping (Prisma rows never leave the module) ---

export function toContractDto(row: Contract, currentRate: CurrentRate | null = null): ContractDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    partnerId: row.partnerId,
    startDate: row.startDate,
    endDate: row.endDate,
    assignedEmployeeId: row.assignedEmployeeId,
    currentRate,
    currency: row.currency,
    paymentTerms: row.paymentTerms,
    vatRegistrationId: row.vatRegistrationId,
    externalReferences: toReferences(row.externalReferences),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

// --- Service Functions ---

function toCurrentRate(
  r: { id: string; rate: string; unit: CurrentRate["unit"] } | undefined,
): CurrentRate | null {
  return r ? { id: r.id, rate: r.rate, unit: r.unit } : null;
}

/**
 * Contracts of a partner, newest first. `today` (clock.today()) drives the derived `currentRate` (D24) — pass it
 * from the action or page; when omitted the DTOs carry `currentRate: null` (writes don't need it).
 */
export async function getContracts(
  tx: TransactionClient,
  partnerId: string,
  options?: { includeInactive?: boolean; today?: string },
): Promise<ServiceResult<ContractDto[]>> {
  const where: Prisma.ContractWhereInput = { partnerId };
  if (!options?.includeInactive) {
    where.isActive = true;
  }
  const contracts = await tx.contract.findMany({
    where,
    orderBy: { startDate: "desc" },
  });
  const current = options?.today
    ? await currentRatesFor(
        tx,
        contracts.map((c) => c.id),
        options.today,
      )
    : new Map();
  return { data: contracts.map((c) => toContractDto(c, toCurrentRate(current.get(c.id)))) };
}

/**
 * How many active contracts a partner holds as the client (`partnerId`) or is assigned to as the employee
 * (`assignedEmployeeId`) — for partners' type-removal guard (audit 25). Exactly one of the two.
 */
export async function activeContractCount(
  tx: TransactionClient,
  by: { partnerId: string } | { assignedEmployeeId: string },
): Promise<number> {
  return tx.contract.count({ where: { ...by, isActive: true } });
}

export async function getContract(
  tx: TransactionClient,
  id: string,
  options?: { today?: string },
): Promise<ServiceResult<ContractDto>> {
  const contract = await tx.contract.findUnique({ where: { id } });
  if (!contract) {
    return { error: { code: "NOT_FOUND", message: `Contract not found: ${id}`, retryable: false } };
  }
  const current = options?.today ? await currentRatesFor(tx, [id], options.today) : new Map();
  return { data: toContractDto(contract, toCurrentRate(current.get(id))) };
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
      currency: data.currency || null,
      paymentTerms: data.paymentTerms || null,
      vatRegistrationId: data.vatRegistrationId || null,
      externalReferences: referencesToJson(data.externalReferences ?? []),
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
  const updateData: Prisma.ContractUncheckedUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
  if (data.assignedEmployeeId !== undefined)
    updateData.assignedEmployeeId = data.assignedEmployeeId || null;
  if (data.currency !== undefined) updateData.currency = data.currency || null;
  if (data.paymentTerms !== undefined) updateData.paymentTerms = data.paymentTerms || null;
  if (data.vatRegistrationId !== undefined)
    updateData.vatRegistrationId = data.vatRegistrationId || null;
  if (data.externalReferences !== undefined)
    updateData.externalReferences = referencesToJson(data.externalReferences);

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
