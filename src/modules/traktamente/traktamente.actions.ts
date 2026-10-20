"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import {
  countryOptions,
  getTrip,
  listRates,
  previewPerDiem,
  rateYears,
} from "@/modules/traktamente/queries";
import * as rates from "@/modules/traktamente/rates";
import * as trips from "@/modules/traktamente/trip";

const forbidden = {
  error: { code: "FORBIDDEN" as const, message: "Not allowed to read expenses", retryable: false },
};
const uuid = z.string().uuid();
const year = z.number().int().min(2000).max(2100);

// --- reads ---

export const listRatesAction = authedAction
  .schema(z.object({ year: year.optional() }))
  .metadata({ name: "listTraktamenteRates" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return {
      data: { years: await rateYears(ctx.tx), rates: await listRates(ctx.tx, parsedInput.year) },
    };
  });

export const countryOptionsAction = authedAction
  .schema(z.object({ year, locale: z.enum(["sv", "en"]).optional() }))
  .metadata({ name: "traktamenteCountries" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return { data: await countryOptions(ctx.tx, parsedInput.year, parsedInput.locale) };
  });

export const getTripAction = authedAction
  .schema(z.object({ groupId: uuid }))
  .metadata({ name: "getTrip" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return { data: await getTrip(ctx.tx, parsedInput.groupId) };
  });

export const previewPerDiemAction = authedAction
  .schema(z.object({ groupId: uuid }))
  .metadata({ name: "previewPerDiem" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return previewPerDiem(ctx.tx, parsedInput.groupId);
  });

// --- writes (owner only) ---

export const upsertRateAction = ownerAction
  .schema(rates.rateInputSchema)
  .metadata({ name: "upsertTraktamenteRate" })
  .action(async ({ ctx, parsedInput }) =>
    rates.upsertRate(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const deleteRateAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteTraktamenteRate" })
  .action(async ({ ctx, parsedInput }) =>
    rates.deleteRate(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

export const copyRatesFromYearAction = ownerAction
  .schema(z.object({ fromYear: year, toYear: year }))
  .metadata({ name: "copyTraktamenteRates" })
  .action(async ({ ctx, parsedInput }) =>
    rates.copyRatesFromYear(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const pasteSkatteverketCsvAction = ownerAction
  .schema(rates.pasteSchema)
  .metadata({ name: "pasteSkatteverketCsv" })
  .action(async ({ ctx, parsedInput }) =>
    rates.pasteSkatteverketCsv(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const upsertTripAction = ownerAction
  .schema(trips.tripInputSchema)
  .metadata({ name: "upsertTrip" })
  .action(async ({ ctx, parsedInput }) =>
    trips.upsertTrip(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const createPerDiemExpenseAction = ownerAction
  .schema(z.object({ groupId: uuid, basCode: z.string().regex(/^\d{3,4}$/) }))
  .metadata({ name: "createPerDiemExpense" })
  .action(async ({ ctx, parsedInput }) =>
    trips.createOrReplacePerDiemExpense(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );
