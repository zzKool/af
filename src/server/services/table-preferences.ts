import type { TransactionClient } from "@/server/db/tenant-client";
import type { AppError } from "@/types/app-error";
import type { CallerIdentity } from "@/types/caller-identity";

// MUST NOT import from next/* or src/components/*

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
  tx: TransactionClient,
  caller: CallerIdentity,
  tableKey: string,
): Promise<ServiceResult<TablePreferenceData | null>> {
  const pref = await tx.tablePreference.findUnique({
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
  tx: TransactionClient,
  caller: CallerIdentity,
  tableKey: string,
  preferences: Record<string, unknown>,
): Promise<ServiceResult<TablePreferenceData>> {
  // Cast to satisfy Prisma InputJsonValue — Record<string, unknown> is always valid JSON
  // biome-ignore lint/suspicious/noExplicitAny: Prisma Json type requires compatible cast
  const jsonPreferences = preferences as any;

  const result = await tx.tablePreference.upsert({
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
