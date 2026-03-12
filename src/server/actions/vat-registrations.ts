"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/server/middleware/action-client";
import * as vatService from "@/server/services/vat-registrations";

/**
 * Get all VAT registrations for the tenant — owner only.
 * Unlike BAS categories (authedAction for reference reads), VAT registrations
 * are tenant-private data, so ownerAction is correct for reads too.
 */
export const getVatRegistrations = ownerAction.schema(z.object({})).action(async ({ ctx }) => {
  return vatService.getVatRegistrations(ctx.tx, ctx.callerIdentity);
});

/**
 * Create a new VAT registration — owner only.
 */
export const createVatRegistration = ownerAction
  .schema(
    z.object({
      country: z.string().trim().toUpperCase().length(2),
      vatNumber: z.string().min(1).max(50).trim(),
      rateSchedule: vatService.rateScheduleSchema.optional(),
    }),
  )
  .action(async ({ ctx, parsedInput }) => {
    return vatService.createVatRegistration(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * Update an existing VAT registration — owner only.
 * Country is immutable after creation — not in schema.
 */
export const updateVatRegistration = ownerAction
  .schema(
    z.object({
      id: z.string().uuid(),
      vatNumber: z.string().min(1).max(50).trim().optional(),
      rateSchedule: vatService.rateScheduleSchema.nullable().optional(),
    }),
  )
  .action(async ({ ctx, parsedInput }) => {
    const { id, ...input } = parsedInput;
    return vatService.updateVatRegistration(ctx.tx, ctx.callerIdentity, ctx.audit, id, input);
  });

/**
 * Delete a VAT registration — owner only.
 */
export const deleteVatRegistration = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .action(async ({ ctx, parsedInput }) => {
    return vatService.deleteVatRegistration(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });
