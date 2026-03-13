import { z } from "zod/v4";
import type { TransactionClient } from "@/server/db/tenant-client";
import { toAuditData } from "@/server/services/audit";
import type { AppError } from "@/types/app-error";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";

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

export const createPartnerSchema = z.object({
  name: z.string().min(1).max(200),
  orgNumber: z.string().max(20).optional(),
  vatNumber: z.string().max(20).optional(),
  types: z.array(partnerTypeSchema).min(1, "At least one type required"),
  defaultCurrency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
  defaultLanguage: z.string().optional(),
  defaultBasCategoryCode: z.string().optional(),
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

// --- Service Functions ---

export async function getPartners(
  tx: TransactionClient,
  options?: { includeInactive?: boolean; search?: string },
): Promise<ServiceResult<Awaited<ReturnType<typeof tx.partner.findMany>>>> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic where clause construction
  const where: any = {};
  if (!options?.includeInactive) {
    where.isActive = true;
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
  return { data: partners };
}

export async function getPartner(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<Awaited<ReturnType<typeof tx.partner.findUnique>>>> {
  const partner = await tx.partner.findUnique({ where: { id } });
  if (!partner) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }
  return { data: partner };
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
        orgNumber: data.orgNumber || null,
        vatNumber: data.vatNumber || null,
        types: data.types,
        defaultCurrency: data.defaultCurrency || null,
        defaultLanguage: data.defaultLanguage || null,
        defaultBasCategoryCode: data.defaultBasCategoryCode || null,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma's InputJsonValue is too narrow for our JSONB shape
        externalIdentifiers: (data.externalIdentifiers ?? []) as any,
        email: data.email || null,
        phone: data.phone || null,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma's InputJsonValue is too narrow for our JSONB shape
        address: (data.address as any) ?? undefined,
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
          message: "A partner with this org number already exists in this tenant",
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

  // Build update data — only include provided fields
  // biome-ignore lint/suspicious/noExplicitAny: dynamic update data construction
  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.orgNumber !== undefined) updateData.orgNumber = data.orgNumber || null;
  if (data.vatNumber !== undefined) updateData.vatNumber = data.vatNumber || null;
  if (data.types !== undefined) updateData.types = data.types;
  if (data.defaultCurrency !== undefined) updateData.defaultCurrency = data.defaultCurrency || null;
  if (data.defaultLanguage !== undefined) updateData.defaultLanguage = data.defaultLanguage || null;
  if (data.defaultBasCategoryCode !== undefined)
    updateData.defaultBasCategoryCode = data.defaultBasCategoryCode || null;
  if (data.externalIdentifiers !== undefined)
    updateData.externalIdentifiers = data.externalIdentifiers;
  if (data.email !== undefined) updateData.email = data.email || null;
  if (data.phone !== undefined) updateData.phone = data.phone || null;
  if (data.address !== undefined) updateData.address = data.address ?? undefined;

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
          message: "A partner with this org number already exists in this tenant",
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
): Promise<
  ServiceResult<
    {
      id: string;
      name: string;
      types: string[];
      defaultCurrency: string | null;
      defaultBasCategoryCode: string | null;
    }[]
  >
> {
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
      types: true,
      defaultCurrency: true,
      defaultBasCategoryCode: true,
    },
    orderBy: { name: "asc" },
    take: Math.min(limit, 20),
  });
  return { data: partners };
}
