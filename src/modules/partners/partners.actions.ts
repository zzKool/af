"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/kernel/actions/action-client";
import * as partnerService from "@/modules/partners/partners";

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
  .metadata({ name: "getPartners" })
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.getPartners(ctx.tx, parsedInput);
  });

/**
 * Get a single partner by ID — owner only.
 */
export const getPartnerAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "getPartner" })
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.getPartner(ctx.tx, parsedInput.id);
  });

/**
 * Create a new partner — owner only.
 */
export const createPartnerAction = ownerAction
  .schema(partnerService.createPartnerSchema)
  .metadata({ name: "createPartner" })
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.createPartner(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * Update an existing partner — owner only.
 */
export const updatePartnerAction = ownerAction
  .schema(partnerService.updatePartnerSchema)
  .metadata({ name: "updatePartner" })
  .action(async ({ ctx, parsedInput }) => {
    const { id, ...data } = parsedInput;
    return partnerService.updatePartner(ctx.tx, ctx.callerIdentity, ctx.audit, id, data);
  });

/**
 * Deactivate (soft-delete) a partner — owner only.
 */
export const deactivatePartnerAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "deactivatePartner" })
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.deactivatePartner(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

/**
 * Reactivate a previously deactivated partner — owner only.
 */
export const reactivatePartnerAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "reactivatePartner" })
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.reactivatePartner(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

/**
 * Search partners for autocomplete/selector — owner only.
 */
export const searchPartnersAction = ownerAction
  .schema(z.object({ query: z.string().min(1).max(100) }))
  .metadata({ name: "searchPartners" })
  .action(async ({ ctx, parsedInput }) => {
    return partnerService.searchPartners(ctx.tx, parsedInput.query);
  });
