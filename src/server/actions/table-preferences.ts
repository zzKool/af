"use server";

import { z } from "zod/v4";
import { authedAction } from "@/server/middleware/action-client";
import * as tablePrefsService from "@/server/services/table-preferences";

/**
 * Get table preference — any authenticated user can read their own table preferences.
 */
export const getTablePreferenceAction = authedAction
  .schema(
    z.object({
      tableKey: z.string().min(1).max(50),
    }),
  )
  .metadata({ name: "getTablePreference" })
  .action(async ({ ctx, parsedInput }) => {
    return tablePrefsService.getTablePreference(ctx.tx, ctx.callerIdentity, parsedInput.tableKey);
  });

/**
 * Upsert table preference — any authenticated user can save their own table preferences.
 * Called with debounced writes from client (2s after last filter change).
 */
export const upsertTablePreferenceAction = authedAction
  .schema(
    z.object({
      tableKey: z.string().min(1).max(50),
      preferences: z.record(z.string(), z.unknown()),
    }),
  )
  .metadata({ name: "upsertTablePreference" })
  .action(async ({ ctx, parsedInput }) => {
    return tablePrefsService.upsertTablePreference(
      ctx.tx,
      ctx.callerIdentity,
      parsedInput.tableKey,
      parsedInput.preferences,
    );
  });
