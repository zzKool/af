"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/kernel/actions/action-client";
import * as settingsService from "@/modules/settings/settings";

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  orgNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
  website: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  currency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
});

/**
 * Read tenant profile — owner only.
 */
export const getTenantProfileAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "getTenantProfile" })
  .action(async ({ ctx }) => {
    return settingsService.getTenantProfile(ctx.tx, ctx.callerIdentity);
  });

/**
 * Update tenant profile — owner only.
 * VALIDATE FIRST, WRITE SECOND — never return AppError after a DB write.
 */
export const updateTenantProfileAction = ownerAction
  .schema(updateProfileSchema)
  .metadata({ name: "updateTenantProfile" })
  .action(async ({ ctx, parsedInput }) => {
    return settingsService.updateTenantProfile(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * List tenant members — owner only.
 */
export const listTenantMembersAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "listTenantMembers" })
  .action(async ({ ctx }) => {
    return settingsService.listTenantMembers(ctx.tx, ctx.callerIdentity);
  });
