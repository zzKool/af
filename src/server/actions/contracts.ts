"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/server/middleware/action-client";
import * as contractService from "@/server/services/contracts";

/**
 * Get all contracts for a partner — owner only.
 */
export const getContractsAction = ownerAction
  .schema(
    z.object({
      partnerId: z.string().uuid(),
      includeInactive: z.boolean().optional(),
    }),
  )
  .action(async ({ ctx, parsedInput }) => {
    return contractService.getContracts(ctx.tx, parsedInput.partnerId, parsedInput);
  });

/**
 * Get a single contract by ID — owner only.
 */
export const getContractAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .action(async ({ ctx, parsedInput }) => {
    return contractService.getContract(ctx.tx, parsedInput.id);
  });

/**
 * Create a new contract — owner only.
 */
export const createContractAction = ownerAction
  .schema(contractService.createContractSchema)
  .action(async ({ ctx, parsedInput }) => {
    return contractService.createContract(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * Update an existing contract — owner only.
 */
export const updateContractAction = ownerAction
  .schema(contractService.updateContractSchema)
  .action(async ({ ctx, parsedInput }) => {
    const { id, ...data } = parsedInput;
    return contractService.updateContract(ctx.tx, ctx.callerIdentity, ctx.audit, id, data);
  });

/**
 * Deactivate (soft-delete) a contract — owner only.
 */
export const deactivateContractAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .action(async ({ ctx, parsedInput }) => {
    return contractService.deactivateContract(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
    );
  });

/**
 * Reactivate a previously deactivated contract — owner only.
 */
export const reactivateContractAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .action(async ({ ctx, parsedInput }) => {
    return contractService.reactivateContract(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
    );
  });
