"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/server/middleware/action-client";
import * as bankService from "@/server/services/bank-accounts";

/**
 * Get all bank CSV formats (app-level reference data).
 * Any authenticated user can read — same pattern as getBasCategories.
 */
export const getBankFormats = authedAction
  .schema(z.object({}))
  .metadata({ name: "getBankFormats" })
  .action(async ({ ctx }) => {
    const formats = await bankService.getBankFormats(ctx.tx);
    return { data: formats };
  });

/**
 * Get all bank accounts for the tenant — owner only.
 * Tenant-private data, so ownerAction is correct for reads too.
 */
export const getBankAccounts = ownerAction
  .schema(z.object({}))
  .metadata({ name: "getBankAccounts" })
  .action(async ({ ctx }) => {
    return bankService.getBankAccounts(ctx.tx, ctx.callerIdentity);
  });

/**
 * Create a new bank account — owner only.
 */
export const createBankAccount = ownerAction
  .schema(
    z.object({
      accountAlias: z.string().trim().max(100).optional(),
      accountNumber: z.string().trim().min(1).max(50),
      currency: z.string().toUpperCase().length(3),
      bankFormatId: z.string().uuid(),
    }),
  )
  .metadata({ name: "createBankAccount" })
  .action(async ({ ctx, parsedInput }) => {
    return bankService.createBankAccount(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * Update an existing bank account — owner only.
 */
export const updateBankAccount = ownerAction
  .schema(
    z.object({
      id: z.string().uuid(),
      accountAlias: z.string().trim().max(100).nullable().optional(),
      accountNumber: z.string().trim().min(1).max(50).optional(),
      currency: z.string().toUpperCase().length(3).optional(),
      bankFormatId: z.string().uuid().optional(),
    }),
  )
  .metadata({ name: "updateBankAccount" })
  .action(async ({ ctx, parsedInput }) => {
    const { id, ...input } = parsedInput;
    return bankService.updateBankAccount(ctx.tx, ctx.callerIdentity, ctx.audit, id, input);
  });

/**
 * Delete a bank account — owner only.
 */
export const deleteBankAccount = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "deleteBankAccount" })
  .action(async ({ ctx, parsedInput }) => {
    return bankService.deleteBankAccount(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });
