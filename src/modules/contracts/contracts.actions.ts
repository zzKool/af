"use server";

import { z } from "zod/v4";
import { ownerAction } from "@/kernel/actions/action-client";
import { createClock } from "@/kernel/clock/clock";
import * as rateService from "@/modules/contracts/contract-rates";
import * as contractService from "@/modules/contracts/contracts";

const clock = createClock();

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
  .metadata({ name: "getContracts" })
  .action(async ({ ctx, parsedInput }) => {
    return contractService.getContracts(ctx.tx, parsedInput.partnerId, {
      ...parsedInput,
      today: clock.today(),
    });
  });

/**
 * Get a single contract by ID — owner only.
 */
export const getContractAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "getContract" })
  .action(async ({ ctx, parsedInput }) => {
    return contractService.getContract(ctx.tx, parsedInput.id, { today: clock.today() });
  });

/**
 * Create a new contract — owner only.
 */
export const createContractAction = ownerAction
  .schema(contractService.createContractSchema)
  .metadata({ name: "createContract" })
  .action(async ({ ctx, parsedInput }) => {
    return contractService.createContract(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/**
 * Update an existing contract — owner only.
 */
export const updateContractAction = ownerAction
  .schema(contractService.updateContractSchema)
  .metadata({ name: "updateContract" })
  .action(async ({ ctx, parsedInput }) => {
    const { id, ...data } = parsedInput;
    return contractService.updateContract(ctx.tx, ctx.callerIdentity, ctx.audit, id, data);
  });

/**
 * Deactivate (soft-delete) a contract — owner only.
 */
export const deactivateContractAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "deactivateContract" })
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
  .metadata({ name: "reactivateContract" })
  .action(async ({ ctx, parsedInput }) => {
    return contractService.reactivateContract(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
    );
  });

// --- Rates (D24) ---

/** Rates of one contract, newest first, with the derived state — owner only. */
export const getContractRatesAction = ownerAction
  .schema(z.object({ contractId: z.string().uuid() }))
  .metadata({ name: "getContractRates" })
  .action(async ({ ctx, parsedInput }) => {
    return rateService.listContractRates(ctx.tx, parsedInput.contractId, clock.today());
  });

/** Add a rate; an open-ended one closes the previous open rate on the day before — owner only. */
export const createContractRateAction = ownerAction
  .schema(rateService.createContractRateSchema)
  .metadata({ name: "createContractRate" })
  .action(async ({ ctx, parsedInput }) => {
    return rateService.createContractRate(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/** Edit dates, amount or note of a rate — owner only. */
export const updateContractRateAction = ownerAction
  .schema(rateService.updateContractRateSchema)
  .metadata({ name: "updateContractRate" })
  .action(async ({ ctx, parsedInput }) => {
    return rateService.updateContractRate(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

/** Delete a rate no invoice line uses — owner only. */
export const deleteContractRateAction = ownerAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "deleteContractRate" })
  .action(async ({ ctx, parsedInput }) => {
    return rateService.deleteContractRate(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });
