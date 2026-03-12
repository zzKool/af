"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/server/middleware/action-client";
import * as basService from "@/server/services/bas-preferences";

/**
 * Get all BAS categories (shared reference data).
 * Any authenticated user can read — broader access than ownerAction
 * since any user may need category names for display.
 */
export const getBasCategories = authedAction.schema(z.object({})).action(async ({ ctx }) => {
  const categories = await basService.getBasCategories(ctx.tx);
  return { data: categories };
});

/**
 * Get tenant's BAS preferences (RLS-scoped).
 * Any authenticated user can read their tenant's preferences.
 */
export const getTenantBasPreferences = authedAction.schema(z.object({})).action(async ({ ctx }) => {
  return basService.getTenantBasPreferences(ctx.tx, ctx.callerIdentity);
});

/**
 * Activate BAS categories for the tenant — owner only.
 */
export const activateBasCategories = ownerAction
  .schema(z.object({ codes: z.array(z.string().min(1).max(4)) }))
  .action(async ({ ctx, parsedInput }) => {
    return basService.activateBasCategories(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.codes,
    );
  });

/**
 * Deactivate a BAS category for the tenant — owner only.
 */
export const deactivateBasCategory = ownerAction
  .schema(z.object({ basCode: z.string().min(1).max(4) }))
  .action(async ({ ctx, parsedInput }) => {
    return basService.deactivateBasCategory(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.basCode,
    );
  });

/**
 * Update a BAS preference (favorite, short code, translations) — owner only.
 */
export const updateBasPreference = ownerAction
  .schema(
    z.object({
      basCode: z.string().min(1).max(4),
      isFavorite: z.boolean().optional(),
      shortCode: z.string().max(10).nullable().optional(),
      translations: basService.translationsSchema,
    }),
  )
  .action(async ({ ctx, parsedInput }) => {
    const { basCode, ...input } = parsedInput;
    return basService.updateBasPreference(ctx.tx, ctx.callerIdentity, ctx.audit, basCode, input);
  });
