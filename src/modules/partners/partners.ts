import { z } from "zod/v4";
import type { Partner, Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import type { ExternalIdentifier, PartnerAddress, PartnerDto, PartnerSummaryDto } from "./types";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

// --- Zod Schemas ---

const partnerTypeSchema = z.enum(["client", "vendor", "employee"]);

const externalIdentifierSchema = z.object({
  label: z.string().min(1).max(50),
  value: z.string().min(1).max(100),
});

const addressSchema = z
  .object({
    street: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase())
      .optional(),
  })
  .optional();

export const shortCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{2,6}$/, "2–6 upper-case letters or digits")
  .optional()
  .or(z.literal(""));

export const createPartnerSchema = z.object({
  name: z.string().min(1).max(200),
  shortCode: shortCodeSchema,
  orgNumber: z.string().max(20).optional(),
  vatNumber: z.string().max(20).optional(),
  types: z.array(partnerTypeSchema).min(1, "At least one type required"),
  defaultCurrency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
  defaultLanguage: z.string().optional(),
  defaultBasCategoryCode: z.string().optional(),
  /** a supplier's payment terms — the due-date default of its invoices (null = 30 days) */
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  externalIdentifiers: z.array(externalIdentifierSchema).max(5).default([]),
  email: z.string().email().max(254).optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  address: addressSchema,
});

export const updatePartnerSchema = createPartnerSchema.partial().extend({
  id: z.string().uuid(),
});

export type CreatePartnerInput = z.input<typeof createPartnerSchema>;
export type UpdatePartnerInput = z.input<typeof updatePartnerSchema>;

// --- FK Validation ---

async function validateBasCategoryFK(
  tx: TransactionClient,
  basCode: string,
): Promise<AppError | null> {
  // 1. Verify the BAS category exists globally
  const category = await tx.basCategory.findUnique({
    where: { code: basCode },
  });
  if (!category) {
    return { code: "NOT_FOUND", message: "BAS category not found", retryable: false };
  }
  // 2. Verify the tenant has activated this category (preference record exists = activated)
  const pref = await tx.tenantBasPreference.findFirst({
    where: { basCode },
  });
  if (!pref) {
    return {
      code: "VALIDATION_ERROR",
      message: "BAS category not activated for this tenant",
      retryable: false,
    };
  }
  return null;
}

// --- JSON columns (`external_identifiers`, `address`) — typed once, both ways ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isExternalIdentifier(v: unknown): v is ExternalIdentifier {
  return isRecord(v) && typeof v.label === "string" && typeof v.value === "string";
}

function isPartnerAddress(v: unknown): v is PartnerAddress {
  return isRecord(v) && Object.values(v).every((x) => x === undefined || typeof x === "string");
}

function toIdentifiers(json: Prisma.JsonValue): ExternalIdentifier[] {
  return Array.isArray(json) ? json.filter(isExternalIdentifier) : [];
}

function toAddress(json: Prisma.JsonValue | null): PartnerAddress | null {
  return isPartnerAddress(json) ? json : null;
}

function identifiersToJson(ids: ExternalIdentifier[]): Prisma.InputJsonArray {
  return ids.map((i) => ({ ...i }));
}

/** Drops the undefined keys — what JSON serialisation did before, now visible to the type. */
function addressToJson(
  address: PartnerAddress | null | undefined,
): Prisma.InputJsonObject | undefined {
  if (!address) return undefined;
  return Object.fromEntries(
    Object.entries(address).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

// --- DTO mapping (Prisma rows never leave the module) ---

export function toPartnerDto(row: Partner): PartnerDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    shortCode: row.shortCode,
    orgNumber: row.orgNumber,
    vatNumber: row.vatNumber,
    types: row.types,
    defaultCurrency: row.defaultCurrency,
    defaultLanguage: row.defaultLanguage,
    defaultBasCategoryCode: row.defaultBasCategoryCode,
    paymentTermsDays: row.paymentTermsDays,
    externalIdentifiers: toIdentifiers(row.externalIdentifiers),
    email: row.email,
    phone: row.phone,
    address: toAddress(row.address),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

// --- Service Functions ---

export async function getPartners(
  tx: TransactionClient,
  options?: { includeInactive?: boolean; search?: string; types?: string[] },
): Promise<ServiceResult<PartnerDto[]>> {
  const where: Prisma.PartnerWhereInput = {};
  if (!options?.includeInactive) {
    where.isActive = true;
  }
  if (options?.types && options.types.length > 0) {
    where.types = { hasSome: options.types };
  }
  if (options?.search) {
    const term = options.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { orgNumber: { contains: term, mode: "insensitive" } },
    ];
  }
  const partners = await tx.partner.findMany({
    where,
    orderBy: { name: "asc" },
  });
  return { data: partners.map(toPartnerDto) };
}

export async function getPartner(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<PartnerDto>> {
  const partner = await tx.partner.findUnique({ where: { id } });
  if (!partner) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }
  return { data: toPartnerDto(partner) };
}

export async function createPartner(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  data: CreatePartnerInput,
): Promise<ServiceResult<{ id: string }>> {
  // Validate types
  const typesResult = z.array(partnerTypeSchema).min(1).safeParse(data.types);
  if (!typesResult.success) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "At least one valid type required",
        retryable: false,
      },
    };
  }

  // Validate external identifiers shape
  if (data.externalIdentifiers && data.externalIdentifiers.length > 0) {
    const eiResult = z.array(externalIdentifierSchema).max(5).safeParse(data.externalIdentifiers);
    if (!eiResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid external identifiers",
          retryable: false,
        },
      };
    }
  }

  // FK validation for BAS category
  if (data.defaultBasCategoryCode) {
    const fkError = await validateBasCategoryFK(tx, data.defaultBasCategoryCode);
    if (fkError) return { error: fkError };
  }

  try {
    const partner = await tx.partner.create({
      data: {
        tenantId: caller.tenantId,
        name: data.name,
        shortCode: data.shortCode || null,
        orgNumber: data.orgNumber || null,
        vatNumber: data.vatNumber || null,
        types: data.types,
        defaultCurrency: data.defaultCurrency || null,
        defaultLanguage: data.defaultLanguage || null,
        defaultBasCategoryCode: data.defaultBasCategoryCode || null,
        paymentTermsDays: data.paymentTermsDays ?? null,
        externalIdentifiers: identifiersToJson(data.externalIdentifiers ?? []),
        email: data.email || null,
        phone: data.phone || null,
        address: addressToJson(data.address),
        createdBy: caller.userId,
        source: caller.source,
      },
    });

    await audit.log({
      action: "create",
      entityType: "partner",
      entityId: partner.id,
      newData: toAuditData(partner),
    });

    return { data: { id: partner.id } };
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
          message: "A partner with this org number or short code already exists in this tenant",
          retryable: false,
        },
      };
    }
    throw error;
  }
}

export async function updatePartner(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  data: Omit<UpdatePartnerInput, "id">,
): Promise<ServiceResult<{ updated: boolean }>> {
  const existing = await tx.partner.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }

  // Validate types if provided
  if (data.types !== undefined) {
    const typesResult = z.array(partnerTypeSchema).min(1).safeParse(data.types);
    if (!typesResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "At least one valid type required",
          retryable: false,
        },
      };
    }
  }

  // Validate external identifiers if provided
  if (data.externalIdentifiers !== undefined) {
    const eiResult = z.array(externalIdentifierSchema).max(5).safeParse(data.externalIdentifiers);
    if (!eiResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid external identifiers",
          retryable: false,
        },
      };
    }
  }

  // FK validation for BAS category if changed
  if (data.defaultBasCategoryCode !== undefined && data.defaultBasCategoryCode !== null) {
    const fkError = await validateBasCategoryFK(tx, data.defaultBasCategoryCode);
    if (fkError) return { error: fkError };
  }

  // Type-removal guard: prevent removing types referenced by active contracts
  if (data.types !== undefined) {
    const removingClient = existing.types.includes("client") && !data.types.includes("client");
    if (removingClient) {
      const activeContracts = await tx.contract.count({
        where: { partnerId: id, isActive: true },
      });
      if (activeContracts > 0) {
        return {
          error: {
            code: "VALIDATION_ERROR",
            message: "Cannot remove client type — partner has active contracts.",
            retryable: false,
          },
        };
      }
    }

    const removingEmployee =
      existing.types.includes("employee") && !data.types.includes("employee");
    if (removingEmployee) {
      const assignedContracts = await tx.contract.count({
        where: { assignedEmployeeId: id, isActive: true },
      });
      if (assignedContracts > 0) {
        return {
          error: {
            code: "VALIDATION_ERROR",
            message: "Cannot remove employee type — partner is assigned to active contracts.",
            retryable: false,
          },
        };
      }
    }
  }

  // Build update data — only include provided fields
  const updateData: Prisma.PartnerUncheckedUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.shortCode !== undefined) updateData.shortCode = data.shortCode || null;
  if (data.orgNumber !== undefined) updateData.orgNumber = data.orgNumber || null;
  if (data.vatNumber !== undefined) updateData.vatNumber = data.vatNumber || null;
  if (data.types !== undefined) updateData.types = data.types;
  if (data.defaultCurrency !== undefined) updateData.defaultCurrency = data.defaultCurrency || null;
  if (data.defaultLanguage !== undefined) updateData.defaultLanguage = data.defaultLanguage || null;
  if (data.defaultBasCategoryCode !== undefined)
    updateData.defaultBasCategoryCode = data.defaultBasCategoryCode || null;
  if (data.paymentTermsDays !== undefined) updateData.paymentTermsDays = data.paymentTermsDays;
  if (data.externalIdentifiers !== undefined)
    updateData.externalIdentifiers = identifiersToJson(data.externalIdentifiers);
  if (data.email !== undefined) updateData.email = data.email || null;
  if (data.phone !== undefined) updateData.phone = data.phone || null;
  if (data.address !== undefined) updateData.address = addressToJson(data.address);

  try {
    const updated = await tx.partner.update({
      where: { id },
      data: updateData,
    });

    await audit.log({
      action: "update",
      entityType: "partner",
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
          message: "A partner with this org number or short code already exists in this tenant",
          retryable: false,
        },
      };
    }
    throw error;
  }
}

export async function deactivatePartner(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deactivated: boolean }>> {
  const existing = await tx.partner.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }
  if (!existing.isActive) {
    return {
      error: { code: "VALIDATION_ERROR", message: "Partner is already inactive", retryable: false },
    };
  }

  const updated = await tx.partner.update({
    where: { id },
    data: { isActive: false },
  });

  await audit.log({
    action: "deactivate",
    entityType: "partner",
    entityId: id,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { deactivated: true } };
}

export async function reactivatePartner(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ reactivated: boolean }>> {
  const existing = await tx.partner.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }
  if (existing.isActive) {
    return {
      error: { code: "VALIDATION_ERROR", message: "Partner is already active", retryable: false },
    };
  }

  const updated = await tx.partner.update({
    where: { id },
    data: { isActive: true },
  });

  await audit.log({
    action: "reactivate",
    entityType: "partner",
    entityId: id,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { reactivated: true } };
}

export async function searchPartners(
  tx: TransactionClient,
  query: string,
  limit = 20,
): Promise<ServiceResult<PartnerSummaryDto[]>> {
  const partners = await tx.partner.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { orgNumber: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      shortCode: true,
      types: true,
      defaultCurrency: true,
      defaultBasCategoryCode: true,
    },
    orderBy: { name: "asc" },
    take: Math.min(limit, 20),
  });
  return { data: partners };
}
