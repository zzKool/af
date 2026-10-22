import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { SUPPORTED_LOCALES } from "@/kernel/nav/constants";
import { parseTheme, type Theme } from "@/kernel/ui/theme";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

export type UserPreferences = {
  locale: string | null;
  /** light / dark; null = follow the system (D43) */
  theme: Theme | null;
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
  return { data: { locale: pref?.locale ?? null, theme: parseTheme(pref?.theme) } };
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

/**
 * Update the user's colour scheme (D43): light, dark, or null = follow the system.
 * Same upsert as the locale; the other preference is left as it is.
 */
export async function updateUserTheme(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  theme: Theme | null,
): Promise<ServiceResult<{ updated: boolean }>> {
  if (theme !== null && parseTheme(theme) === null) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Unsupported theme: "${theme}". Supported: light, dark, or none (system)`,
        retryable: false,
      },
    };
  }

  const existing = await tx.userPreference.findUnique({
    where: { userId: caller.userId },
  });

  const result = await tx.userPreference.upsert({
    where: { userId: caller.userId },
    create: { userId: caller.userId, theme, source: "manual" },
    update: { theme },
  });

  await audit.log({
    action: existing ? "update" : "create",
    entityType: "user_preference",
    entityId: result.id,
    oldData: existing ? { theme: existing.theme } : null,
    newData: { theme: result.theme },
  });

  return { data: { updated: true } };
}
