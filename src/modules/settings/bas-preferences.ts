import { z } from "zod/v4";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

export const translationsSchema = z
  .object({
    en: z.string().optional(),
    sv: z.string().optional(),
    fr: z.string().optional(),
  })
  .strict()
  .optional();

export type BasTranslations = z.infer<typeof translationsSchema>;

/**
 * Get all BAS categories (shared reference data, no RLS).
 * Any authenticated user can read — no caller/audit params needed.
 *
 * Architectural exception: bas_categories has no tenant_id and no RLS.
 * It's a read-only reference table (immutability enforced via PostgreSQL RULEs).
 * Natural key: BasCategory.code (3-digit BAS code) is the @id, not a UUID.
 * Updated yearly from bas.se XLSX files via prisma/data/parse-bas.mjs.
 */
export async function getBasCategories(tx: TransactionClient) {
  const categories = await tx.basCategory.findMany({
    orderBy: [{ classNum: "asc" }, { code: "asc" }],
  });
  return categories;
}

/** One BAS group by its 3-digit code (reference data) — null when unknown. Used to validate `bas_code` columns. */
export async function getBasCategory(
  tx: TransactionClient,
  code: string,
): Promise<{ code: string; name: string; nameEn: string | null; nameFr: string | null } | null> {
  const c = await tx.basCategory.findUnique({
    where: { code },
    select: { code: true, name: true, nameEn: true, nameFr: true },
  });
  return c;
}

/**
 * The short code the owner's keys carry (`Tr` in `Ex213-Tr-01`): the tenant's own short code for the category,
 * else the curated suggestion; null when neither exists — the caller refuses and points to Settings → BAS.
 */
export async function basAliases(
  tx: TransactionClient,
  codes: readonly string[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();
  const rows = await tx.basCategory.findMany({
    where: { code: { in: unique } },
    select: { code: true, suggestedAlias: true },
  });
  const prefs = await tx.tenantBasPreference.findMany({
    where: { basCode: { in: unique } },
    select: { basCode: true, shortCode: true },
  });
  const own = new Map(prefs.map((p) => [p.basCode, p.shortCode?.trim() || null]));
  return new Map(rows.map((r) => [r.code, own.get(r.code) ?? r.suggestedAlias?.trim() ?? null]));
}

export async function basAlias(tx: TransactionClient, code: string): Promise<string | null> {
  return (await basAliases(tx, [code])).get(code) ?? null;
}

/** Labels for a set of BAS codes (`657 · Bankkostnader`), for list rows and filter options. */
export async function basLabels(
  tx: TransactionClient,
  codes: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();
  const rows = await tx.basCategory.findMany({
    where: { code: { in: unique } },
    select: { code: true, name: true },
  });
  return new Map(rows.map((r) => [r.code, `${r.code} · ${r.name}`]));
}

/**
 * Get tenant's BAS preferences (RLS-scoped by middleware).
 * Read-only — no audit param needed.
 */
export async function getTenantBasPreferences(
  tx: TransactionClient,
  _caller: CallerIdentity,
): Promise<
  ServiceResult<
    {
      id: string;
      basCode: string;
      isFavorite: boolean;
      shortCode: string | null;
      translations: unknown;
      basCategory: {
        code: string;
        name: string;
        nameEn: string | null;
        nameFr: string | null;
        className: string;
        classNum: number;
        isCommon: boolean;
        suggestedAlias: string | null;
      };
    }[]
  >
> {
  const preferences = await tx.tenantBasPreference.findMany({
    include: { basCategory: true },
    orderBy: [{ basCategory: { classNum: "asc" } }, { basCategory: { code: "asc" } }],
  });
  return { data: preferences };
}

/**
 * Activate BAS categories for the tenant (bulk create).
 * Validates that all codes exist in bas_categories.
 */
export async function activateBasCategories(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  codes: string[],
): Promise<ServiceResult<{ activated: number }>> {
  // Validate codes exist in bas_categories
  const existing = await tx.basCategory.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((c) => c.code));
  const invalidCodes = codes.filter((c) => !existingCodes.has(c));
  if (invalidCodes.length > 0) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Invalid BAS codes: ${invalidCodes.join(", ")}`,
        retryable: false,
      },
    };
  }

  // Check for already-activated codes to handle gracefully
  const alreadyActive = await tx.tenantBasPreference.findMany({
    where: { basCode: { in: codes } },
    select: { basCode: true },
  });
  const alreadyActiveCodes = new Set(alreadyActive.map((p) => p.basCode));
  const newCodes = codes.filter((c) => !alreadyActiveCodes.has(c));

  if (newCodes.length === 0) {
    return {
      error: {
        code: "DUPLICATE_ENTRY",
        message: "All specified categories are already activated",
        retryable: false,
      },
    };
  }

  // Bulk create
  await tx.tenantBasPreference.createMany({
    data: newCodes.map((code) => ({
      tenantId: caller.tenantId,
      basCode: code,
      createdBy: caller.userId,
      source: caller.source,
    })),
  });

  // Audit each activation
  for (const code of newCodes) {
    await audit.log({
      action: "create",
      entityType: "tenant_bas_preference",
      entityId: code,
      newData: { basCode: code, tenantId: caller.tenantId },
    });
  }

  return { data: { activated: newCodes.length } };
}

/**
 * Deactivate a BAS category for the tenant (hard delete).
 * Captures old state in audit log before deletion.
 */
export async function deactivateBasCategory(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  basCode: string,
): Promise<ServiceResult<{ deactivated: boolean }>> {
  // Read-before-delete for audit oldData
  const existing = await tx.tenantBasPreference.findUnique({
    where: { tenantId_basCode: { tenantId: caller.tenantId, basCode } },
  });

  if (!existing) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `BAS preference not found for code: ${basCode}`,
        retryable: false,
      },
    };
  }

  await tx.tenantBasPreference.delete({
    where: { id: existing.id },
  });

  await audit.log({
    action: "delete",
    entityType: "tenant_bas_preference",
    entityId: basCode,
    oldData: toAuditData(existing),
  });

  return { data: { deactivated: true } };
}

/**
 * Update a BAS preference (favorite, short code, translations).
 * Supports partial updates — only provided fields are changed.
 */
export async function updateBasPreference(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  basCode: string,
  input: {
    isFavorite?: boolean;
    shortCode?: string | null;
    translations?: BasTranslations;
  },
): Promise<ServiceResult<{ updated: boolean }>> {
  // Validate translations shape if provided
  if (input.translations !== undefined) {
    const result = translationsSchema.safeParse(input.translations);
    if (!result.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid translations shape",
          retryable: false,
        },
      };
    }
  }

  const existing = await tx.tenantBasPreference.findUnique({
    where: { tenantId_basCode: { tenantId: caller.tenantId, basCode } },
  });

  if (!existing) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `BAS preference not found for code: ${basCode}`,
        retryable: false,
      },
    };
  }

  const updateData: Record<string, unknown> = {};
  if (input.isFavorite !== undefined) updateData.isFavorite = input.isFavorite;
  if (input.shortCode !== undefined) updateData.shortCode = input.shortCode;
  if (input.translations !== undefined) updateData.translations = input.translations;

  const updated = await tx.tenantBasPreference.update({
    where: { id: existing.id },
    data: updateData,
  });

  await audit.log({
    action: "update",
    entityType: "tenant_bas_preference",
    entityId: basCode,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { updated: true } };
}
