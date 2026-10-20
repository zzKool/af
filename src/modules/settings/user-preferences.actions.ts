"use server";

import { z } from "zod/v4";
import { authedAction } from "@/kernel/actions/action-client";
import { SUPPORTED_LOCALES } from "@/kernel/nav/constants";
import * as prefsService from "@/modules/settings/user-preferences";

/**
 * Get user preferences — any authenticated user can read their own preferences.
 */
export const getUserPreferencesAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getUserPreferences" })
  .action(async ({ ctx }) => {
    return prefsService.getUserPreferences(ctx.tx, ctx.callerIdentity);
  });

/**
 * Update user locale — any authenticated user can update their own locale.
 */
export const updateUserLocaleAction = authedAction
  .schema(
    z.object({
      locale: z.enum(SUPPORTED_LOCALES).nullable(),
    }),
  )
  .metadata({ name: "updateUserLocale" })
  .action(async ({ ctx, parsedInput }) => {
    return prefsService.updateUserLocale(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.locale);
  });
