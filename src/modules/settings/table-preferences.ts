import type { PrismaClient } from "@/generated/prisma/client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { AppError } from "@/kernel/errors/app-error";

// MUST NOT import from next/* or src/components/*
// NOTE: Uses PrismaClient directly (not TransactionClient) — table_preferences is user-scoped,
// not tenant-scoped, so it must not run inside a tenant RLS transaction (AD3).

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

export type TablePreferenceData = {
  id: string;
  tableKey: string;
  preferences: Record<string, unknown>;
  updatedAt: Date;
};

/**
 * Get table preference for a specific table key.
 * User-scoped — no RLS, accessed by userId from auth context.
 */
export async function getTablePreference(
  prisma: PrismaClient,
  caller: CallerIdentity,
  tableKey: string,
): Promise<ServiceResult<TablePreferenceData | null>> {
  const pref = await prisma.tablePreference.findUnique({
    where: {
      userId_tableKey: {
        userId: caller.userId,
        tableKey,
      },
    },
  });

  if (!pref) {
    return { data: null };
  }

  return {
    data: {
      id: pref.id,
      tableKey: pref.tableKey,
      preferences: pref.preferences as Record<string, unknown>,
      updatedAt: pref.updatedAt,
    },
  };
}

/**
 * Upsert table preference — creates if not exists, updates if exists.
 * User-scoped — no RLS, idempotent via unique(userId, tableKey).
 */
export async function upsertTablePreference(
  prisma: PrismaClient,
  caller: CallerIdentity,
  tableKey: string,
  preferences: Record<string, unknown>,
): Promise<ServiceResult<TablePreferenceData>> {
  // Cast to satisfy Prisma InputJsonValue — Record<string, unknown> is always valid JSON
  // biome-ignore lint/suspicious/noExplicitAny: Prisma Json type requires compatible cast
  const jsonPreferences = preferences as any;

  const result = await prisma.tablePreference.upsert({
    where: {
      userId_tableKey: {
        userId: caller.userId,
        tableKey,
      },
    },
    create: {
      userId: caller.userId,
      tableKey,
      preferences: jsonPreferences,
    },
    update: {
      preferences: jsonPreferences,
    },
  });

  return {
    data: {
      id: result.id,
      tableKey: result.tableKey,
      preferences: result.preferences as Record<string, unknown>,
      updatedAt: result.updatedAt,
    },
  };
}
