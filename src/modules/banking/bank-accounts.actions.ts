"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { uuid } from "@/kernel/validation/scalars";
import * as bankService from "@/modules/banking/bank-accounts";
import * as payers from "@/modules/banking/payers";

/**
 * Get all bank CSV formats (app-level reference data).
 * Any authenticated user can read — same pattern as getBasCategories.
 */
export const getBankFormatsAction = authedAction
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
export const getBankAccountsAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "getBankAccounts" })
  .action(async ({ ctx }) => {
    return bankService.getBankAccounts(ctx.tx, ctx.callerIdentity);
  });

/**
 * Create a new bank account — owner only.
 */
export const createBankAccountAction = ownerAction
  .schema(
    z.object({
      accountAlias: z.string().trim().max(100).optional(),
      accountNumber: z.string().trim().min(1).max(50),
      currency: z.string().toUpperCase().length(3),
      bankFormatId: uuid,
      role: z.enum(["main", "savings"]).optional(),
    }),
  )
  .metadata({ name: "createBankAccount" })
  .action(async ({ ctx, parsedInput }) => {
    return bankService.createBankAccount(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * Update an existing bank account — owner only.
 */
export const updateBankAccountAction = ownerAction
  .schema(
    z.object({
      id: uuid,
      accountAlias: z.string().trim().max(100).nullable().optional(),
      accountNumber: z.string().trim().min(1).max(50).optional(),
      currency: z.string().toUpperCase().length(3).optional(),
      bankFormatId: uuid.optional(),
      role: z.enum(["main", "savings"]).optional(),
      iban: z.string().trim().max(34).nullable().optional(),
      bic: z.string().trim().max(11).nullable().optional(),
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
export const deleteBankAccountAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteBankAccount" })
  .action(async ({ ctx, parsedInput }) => {
    return bankService.deleteBankAccount(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

/** A private instrument of the owner (F114, D60): alias + currency, no format — the payer of a private expense. */
export const createPrivateAccountAction = ownerAction
  .schema(payers.privateAccountSchema)
  .metadata({ name: "createPrivateAccount" })
  .action(async ({ ctx, parsedInput }) =>
    payers.createPrivateAccount(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );
