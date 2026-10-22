import type { Prisma, PrismaClient } from "@/generated/prisma/client";
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

function isJsonObject(v: unknown): v is Prisma.JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The `preferences` JSONB column as read: an object, or `{}` if a row ever held something else. */
function toPreferences(json: Prisma.JsonValue): Record<string, unknown> {
  return isJsonObject(json) ? json : {};
}

/**
 * The client's preferences as Prisma writes them. The JSON round trip is what Prisma's own serialisation
 * does (undefined keys dropped, dates as ISO strings); doing it here makes the value JSON by construction.
 */
function preferencesToJson(preferences: Record<string, unknown>): Prisma.InputJsonObject {
  const json: unknown = JSON.parse(JSON.stringify(preferences));
  return isJsonObject(json) ? json : {};
}

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
      preferences: toPreferences(pref.preferences),
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
  const jsonPreferences = preferencesToJson(preferences);

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
      preferences: toPreferences(result.preferences),
      updatedAt: result.updatedAt,
    },
  };
}
