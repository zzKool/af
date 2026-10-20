"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import "./linkables"; // make sure every module's linkable is registered before a link is validated
import * as linkingService from "./linking";
import { LINK_KINDS } from "./types";

const endpointSchema = z.object({
  type: z.enum([
    "document",
    "partner",
    "contract",
    "bank_transaction",
    "journal_entry",
    "invoice",
    "supplier_invoice",
    "expense",
    "settlement",
  ]),
  id: z.string().uuid(),
});

export const getLinksForAction = authedAction
  .schema(endpointSchema)
  .metadata({ name: "getLinksFor" })
  .action(async ({ ctx, parsedInput }) => linkingService.getLinksFor(ctx.tx, parsedInput));

export const getAllocationStatusAction = authedAction
  .schema(endpointSchema)
  .metadata({ name: "getAllocationStatus" })
  .action(async ({ ctx, parsedInput }) => linkingService.getAllocationStatus(ctx.tx, parsedInput));

export const createLinkAction = ownerAction
  .schema(
    z.object({
      from: endpointSchema,
      to: endpointSchema,
      kind: z.enum(LINK_KINDS as [string, ...string[]]),
      allocatedAmount: z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/)
        .nullable()
        .optional(),
      currency: z.string().length(3).nullable().optional(),
      note: z.string().max(500).nullable().optional(),
    }),
  )
  .metadata({ name: "createLink" })
  .action(async ({ ctx, parsedInput }) =>
    linkingService.createLink(ctx.tx, ctx.callerIdentity, ctx.audit, {
      ...parsedInput,
      kind: parsedInput.kind as (typeof LINK_KINDS)[number],
    }),
  );

export const removeLinkAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "removeLink" })
  .action(async ({ ctx, parsedInput }) =>
    linkingService.removeLink(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );
