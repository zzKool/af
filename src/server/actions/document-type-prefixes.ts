"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/server/middleware/action-client";
import * as prefixService from "@/server/services/document-type-prefixes";

/**
 * Get all document-type prefixes for the tenant — owner only.
 * Delegates seed-on-first-access orchestration to service layer.
 */
export const getDocumentTypePrefixes = ownerAction
  .schema(z.object({}))
  .metadata({ name: "getDocumentTypePrefixes" })
  .action(async ({ ctx }) => {
    return prefixService.getDocumentTypePrefixesWithSeed(ctx.tx, ctx.callerIdentity, ctx.audit);
  });

/**
 * Create a new document-type prefix — owner only.
 */
export const createDocumentTypePrefix = ownerAction
  .schema(
    z.object({
      documentType: prefixService.documentTypeSchema,
      prefix: prefixService.prefixSchema,
    }),
  )
  .metadata({ name: "createDocumentTypePrefix" })
  .action(async ({ ctx, parsedInput }) => {
    return prefixService.createDocumentTypePrefix(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput,
    );
  });

/**
 * Update an existing document-type prefix — owner only.
 * Only prefix field can be updated (documentType is immutable).
 */
export const updateDocumentTypePrefix = ownerAction
  .schema(
    z.object({
      id: z.string().uuid(),
      prefix: prefixService.prefixSchema,
    }),
  )
  .metadata({ name: "updateDocumentTypePrefix" })
  .action(async ({ ctx, parsedInput }) => {
    const { id, ...input } = parsedInput;
    return prefixService.updateDocumentTypePrefix(ctx.tx, ctx.callerIdentity, ctx.audit, id, input);
  });

/**
 * Delete a document-type prefix — owner only.
 */
export const deleteDocumentTypePrefix = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "deleteDocumentTypePrefix" })
  .action(async ({ ctx, parsedInput }) => {
    return prefixService.deleteDocumentTypePrefix(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
    );
  });
