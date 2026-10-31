"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { aiStatus } from "@/kernel/ai/ai";
import { enqueue } from "@/kernel/jobs/queue";
import { confirmUseForNotes } from "@/modules/settings/bas-notes";
import * as basService from "@/modules/settings/bas-preferences";
import { draftUseForJob } from "@/modules/settings/jobs/draft-use-for";

/**
 * Get all BAS categories (shared reference data).
 * Any authenticated user can read — broader access than ownerAction
 * since any user may need category names for display.
 */
export const getBasCategoriesAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getBasCategories" })
  .action(async ({ ctx }) => {
    const categories = await basService.getBasCategories(ctx.tx);
    return { data: categories };
  });

/**
 * Get tenant's BAS preferences (RLS-scoped).
 * Any authenticated user can read their tenant's preferences.
 */
export const getTenantBasPreferencesAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getTenantBasPreferences" })
  .action(async ({ ctx }) => {
    return basService.getTenantBasPreferences(ctx.tx, ctx.callerIdentity);
  });

/**
 * Activate BAS categories for the tenant — owner only.
 */
export const activateBasCategoriesAction = ownerAction
  .schema(z.object({ codes: z.array(z.string().min(1).max(4)) }))
  .metadata({ name: "activateBasCategories" })
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
export const deactivateBasCategoryAction = ownerAction
  .schema(z.object({ basCode: z.string().min(1).max(4) }))
  .metadata({ name: "deactivateBasCategory" })
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
export const updateBasPreferenceAction = ownerAction
  .schema(
    z.object({
      basCode: z.string().min(1).max(4),
      isFavorite: z.boolean().optional(),
      shortCode: z.string().max(10).nullable().optional(),
      translations: basService.translationsSchema,
      useFor: z.string().max(basService.USE_FOR_MAX).nullable().optional(),
    }),
  )
  .metadata({ name: "updateBasPreference" })
  .action(async ({ ctx, parsedInput }) => {
    const { basCode, ...input } = parsedInput;
    return basService.updateBasPreference(ctx.tx, ctx.callerIdentity, ctx.audit, basCode, input);
  });

/** F126: *Draft with AI* — queued after the commit; the drafts appear on the page a minute or two later. */
export const draftUseForNotesAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "draftUseForNotes" })
  .action(async ({ ctx }) => {
    const status = await aiStatus();
    if (status.state === "off" || status.state === "unreachable")
      return {
        error: {
          code: "BUSINESS_RULE_VIOLATION" as const,
          message: "AI not available — the model cannot draft notes now",
          retryable: true,
        },
      };
    const { tenantId, userId } = ctx.callerIdentity;
    ctx.onCommit(async () => {
      await enqueue(draftUseForJob, { tenantId, userId });
    });
    return { data: { queued: true } };
  });

/** F126: the owner confirms drafts as they are — these codes, or all of them. */
export const confirmUseForNotesAction = ownerAction
  .schema(z.object({ codes: z.array(z.string().min(1).max(4)).optional() }))
  .metadata({ name: "confirmUseForNotes" })
  .action(async ({ ctx, parsedInput }) =>
    confirmUseForNotes(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.codes),
  );
