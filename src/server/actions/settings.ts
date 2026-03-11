"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/server/middleware/action-client";
import * as settingsService from "@/server/services/settings";

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  orgNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  currency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
});

/**
 * Read tenant profile — owner only.
 */
export const getTenantProfile = ownerAction.schema(z.object({})).action(async ({ ctx }) => {
  return settingsService.getTenantProfile(ctx.tx, ctx.callerIdentity);
});

/**
 * Update tenant profile — owner only.
 * VALIDATE FIRST, WRITE SECOND — never return AppError after a DB write.
 */
export const updateTenantProfile = ownerAction
  .schema(updateProfileSchema)
  .action(async ({ ctx, parsedInput }) => {
    return settingsService.updateTenantProfile(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * List tenant members — owner only.
 */
export const listTenantMembers = ownerAction.schema(z.object({})).action(async ({ ctx }) => {
  return settingsService.listTenantMembers(ctx.tx, ctx.callerIdentity);
});
