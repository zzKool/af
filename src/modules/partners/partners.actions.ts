"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/kernel/actions/action-client";
import { listQuerySchema } from "@/kernel/list-query/schema";
import { matchPartners } from "@/modules/partners/match";
import * as partnerService from "@/modules/partners/partners";
import {
  distinctPartnerValues,
  PARTNER_COLUMN_KEYS,
  type PartnerColumn,
  partnerDateHierarchy,
} from "@/modules/partners/queries";

const partnerColumnSchema = z
  .string()
  .refine(
    (c): c is PartnerColumn => (PARTNER_COLUMN_KEYS as string[]).includes(c),
    "unknown column",
  );

/** Distinct values with counts for a header filter (Excel semantics: the other filters apply). */
export const distinctPartnersAction = ownerAction
  .schema(z.object({ column: partnerColumnSchema, query: listQuerySchema }))
  .metadata({ name: "distinctPartners" })
  .action(async ({ ctx, parsedInput }) => {
    return {
      data: await distinctPartnerValues(ctx.tx, parsedInput.column, parsedInput.query),
    };
  });

/** Year → month → day counts for a date column's header filter. */
export const partnerDateHierarchyAction = ownerAction
  .schema(z.object({ column: partnerColumnSchema, query: listQuerySchema }))
  .metadata({ name: "partnerDateHierarchy" })
  .action(async ({ ctx, parsedInput }) => {
    return {
      data: await partnerDateHierarchy(ctx.tx, parsedInput.column, parsedInput.query),
    };
  });

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

/**
 * The supplier match for a document's OCR vendor (specs/documents US1): the best partners with their confidence.
 * Owner only — it serves the creation dialogs.
 */
export const matchPartnersAction = ownerAction
  .schema(
    z.object({
      name: z.string().max(200).optional(),
      vatNumber: z.string().max(40).optional(),
      address: z.string().max(400).optional(),
      type: z.enum(["client", "vendor", "employee"]).optional(),
    }),
  )
  .metadata({ name: "matchPartners" })
  .action(async ({ ctx, parsedInput }) => ({
    data: await matchPartners(ctx.tx, parsedInput),
  }));
