"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import "./linkables"; // make sure every module's linkable is registered before a link is validated
import { uuid } from "@/kernel/validation/scalars";
import { GRAPH_MAX_DEPTH, neighbourhood } from "./graph";
import { justifyRow, justifySchema, noProofNeeded, noProofSchema } from "./justify";
import * as linkingService from "./linking";
import { memoryForRow } from "./memory";
import { linksWithLabels } from "./queries";
import * as suggestions from "./suggestions";
import { LINK_KINDS, type LinkableType } from "./types";

const endpointSchema = z.object({
  type: z.enum([
    "document",
    "partner",
    "contract",
    "bank_transaction",
    "invoice",
    "supplier_invoice",
    "expense",
    "subscription",
  ]),
  id: uuid,
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
  .schema(z.object({ id: uuid }))
  .metadata({ name: "removeLink" })
  .action(async ({ ctx, parsedInput }) =>
    linkingService.removeLink(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

// --- suggestions (specs/linking/spec.md) — the accountant sees them, the owner applies ---

const forbidden = {
  error: { code: "FORBIDDEN" as const, message: "Not allowed to read links", retryable: false },
};

export const getLinksWithLabelsAction = authedAction
  .schema(endpointSchema)
  .metadata({ name: "getLinksWithLabels" })
  .action(async ({ ctx, parsedInput }) => ({ data: await linksWithLabels(ctx.tx, parsedInput) }));

/** The neighbourhood of one entity (specs/linking, the graph read model) — anyone who may read links. */
export const graphAction = authedAction
  .schema(endpointSchema.extend({ depth: z.number().int().min(0).max(GRAPH_MAX_DEPTH).optional() }))
  .metadata({ name: "linkGraph" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "link")) return forbidden;
    const { depth, ...root } = parsedInput;
    const graph = await neighbourhood(ctx.tx, root, { depth });
    if (!graph) {
      return {
        error: { code: "NOT_FOUND" as const, message: "Entity not found", retryable: false },
      };
    }
    return { data: graph };
  });

export const suggestionsForTransactionAction = authedAction
  .schema(z.object({ bankTransactionId: uuid }))
  .metadata({ name: "suggestionsForTransaction" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return suggestions.suggestionsForTransaction(ctx.tx, parsedInput.bankTransactionId);
  });

/** The partners this row's counterparty was linked to before, most first (F116 US3 — the Justify panel's proposal). */
export const counterpartyMemoryAction = authedAction
  .schema(z.object({ bankTransactionId: uuid }))
  .metadata({ name: "counterpartyMemory" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return { data: await memoryForRow(ctx.tx, parsedInput.bankTransactionId) };
  });

export const suggestionsForEntityAction = authedAction
  .schema(endpointSchema)
  .metadata({ name: "suggestionsForEntity" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return suggestions.suggestionsForEntity(ctx.tx, parsedInput);
  });

export const searchLinkablesAction = authedAction
  .schema(
    z.object({
      q: z.string().max(200),
      types: z.array(endpointSchema.shape.type).optional(),
    }),
  )
  .metadata({ name: "searchLinkables" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return {
      data: await suggestions.searchLinkables(
        ctx.tx,
        parsedInput.q,
        parsedInput.types as LinkableType[] | undefined,
      ),
    };
  });

export const applySuggestionAction = ownerAction
  .schema(
    z.object({
      bankTransactionId: uuid,
      to: endpointSchema,
      allocatedAmount: z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/)
        .nullable()
        .optional(),
      note: z.string().max(500).nullable().optional(),
    }),
  )
  .metadata({ name: "applySuggestion" })
  .action(async ({ ctx, parsedInput }) =>
    suggestions.applySuggestion(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const bulkApplyHighAction = ownerAction
  .schema(z.object({ bankTransactionIds: z.array(uuid).min(1).max(200) }))
  .metadata({ name: "bulkApplyHigh" })
  .action(async ({ ctx, parsedInput }) => ({
    data: await suggestions.bulkApplyHigh(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.bankTransactionIds,
    ),
  }));

// --- Justify from the bank row (F97): one click, one transaction — owner only ---

export const justifyRowAction = ownerAction
  .schema(justifySchema)
  .metadata({ name: "justifyRow" })
  .action(async ({ ctx, parsedInput }) =>
    justifyRow(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const noProofNeededAction = ownerAction
  .schema(noProofSchema)
  .metadata({ name: "noProofNeeded" })
  .action(async ({ ctx, parsedInput }) =>
    noProofNeeded(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );
