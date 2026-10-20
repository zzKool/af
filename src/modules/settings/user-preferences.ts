import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { SUPPORTED_LOCALES } from "@/kernel/nav/constants";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

export type UserPreferences = {
  locale: string | null;
};

/**
 * Get user preferences for the authenticated user.
 * User-scoped — no RLS, accessed by userId from auth context.
 * Does NOT use withTenantTransaction — direct Prisma query.
 */
export async function getUserPreferences(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<ServiceResult<UserPreferences>> {
  const pref = await tx.userPreference.findUnique({
    where: { userId: caller.userId },
  });
  return { data: { locale: pref?.locale ?? null } };
}

/**
 * Update user locale preference.
 * Upserts: create-if-not-exists, update-if-exists (Prisma upsert on unique userId).
 * Pass null to reset to browser locale default.
 */
export async function updateUserLocale(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  locale: string | null,
): Promise<ServiceResult<{ updated: boolean }>> {
  // Validate locale if not null
  if (locale !== null) {
    const supported = SUPPORTED_LOCALES as readonly string[];
    if (!supported.includes(locale)) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: `Unsupported locale: "${locale}". Supported: ${SUPPORTED_LOCALES.join(", ")}`,
          retryable: false,
        },
      };
    }
  }

  const existing = await tx.userPreference.findUnique({
    where: { userId: caller.userId },
  });

  const result = await tx.userPreference.upsert({
    where: { userId: caller.userId },
    create: {
      userId: caller.userId,
      locale,
      source: "manual",
    },
    update: {
      locale,
    },
  });

  await audit.log({
    action: existing ? "update" : "create",
    entityType: "user_preference",
    entityId: result.id,
    oldData: existing ? { locale: existing.locale } : null,
    newData: { locale: result.locale },
  });

  return { data: { updated: true } };
}
