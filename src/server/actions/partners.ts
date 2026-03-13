"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/server/middleware/action-client";
import * as partnerService from "@/server/services/partners";

/**
 * Get all partners for the tenant — owner only.
 */
export const getPartnersAction = ownerAction
  .schema(
    z.object({
      includeInactive: z.boolean().optional(),
      search: z.string().optional(),
    }),
  )
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.getPartners(ctx.tx, parsedInput);
  });

/**
 * Get a single partner by ID — owner only.
 */
export const getPartnerAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.getPartner(ctx.tx, parsedInput.id);
  });

/**
 * Create a new partner — owner only.
 */
export const createPartnerAction = ownerAction
  .schema(partnerService.createPartnerSchema)
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.createPartner(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * Update an existing partner — owner only.
 */
export const updatePartnerAction = ownerAction
  .schema(partnerService.updatePartnerSchema)
  .action(async ({ ctx, parsedInput }) => {
    const { id, ...data } = parsedInput;
    return partnerService.updatePartner(ctx.tx, ctx.callerIdentity, ctx.audit, id, data);
  });

/**
 * Deactivate (soft-delete) a partner — owner only.
 */
export const deactivatePartnerAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.deactivatePartner(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

/**
 * Reactivate a previously deactivated partner — owner only.
 */
export const reactivatePartnerAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.reactivatePartner(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

/**
 * Search partners for autocomplete/selector — owner only.
 */
export const searchPartnersAction = ownerAction
  .schema(z.object({ query: z.string().min(1).max(100) }))
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.searchPartners(ctx.tx, parsedInput.query);
  });
