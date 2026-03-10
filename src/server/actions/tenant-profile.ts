"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/server/middleware/action-client";

/**
 * Read tenant profile — owner only (settings = no accountant access per access matrix).
 * Minimal reference implementation — Story 1.5 builds the full feature.
 */
export const getTenantProfile = ownerAction.schema(z.object({})).action(async ({ ctx }) => {
  const config = await ctx.tx.tenantConfig.findMany();
  return { config: config.map((c) => ({ key: c.key, value: c.value })) };
});

/**
 * Update tenant profile — owner only.
 * VALIDATE FIRST, WRITE SECOND — never return AppError after a DB write.
 */
export const updateTenantProfile = ownerAction
  .schema(z.object({ name: z.string().min(1) }))
  .action(async ({ ctx, parsedInput }) => {
    await ctx.tx.tenantConfig.upsert({
      where: {
        tenantId_key: { tenantId: ctx.callerIdentity.tenantId, key: "company_name" },
      },
      update: { value: parsedInput.name },
      create: {
        tenantId: ctx.callerIdentity.tenantId,
        key: "company_name",
        value: parsedInput.name,
        createdBy: ctx.callerIdentity.userId,
        source: "user",
      },
    });
    return { success: true };
  });
