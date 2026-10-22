"use server";

// Server Actions of the exports module (server-action-pattern): the return and its periods are read by owner and
// accountant; the manual refs, declaring and marking paid are the owner's.
import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { uuid } from "@/kernel/validation/scalars";
import {
  declare,
  declareSchema,
  markPaid,
  markPaidSchema,
  saveManual,
  saveManualSchema,
  undeclare,
  unmarkPaid,
} from "./declarations";
import { chRegistrations, swissVatPeriods, swissVatReturn, vatPaymentOptions } from "./queries";
import { isSwissVatPeriod } from "./swiss-vat";

const clock = createClock();
const forbidden = {
  error: {
    code: "FORBIDDEN" as const,
    message: "Only the owner and the accountant see the declarations",
    retryable: false,
  },
};
const period = z.string().refine(isSwissVatPeriod, "Expected a period like CH 2026/Q2");

export const getSwissVatReturnAction = authedAction
  .schema(z.object({ registrationId: uuid, period }))
  .metadata({ name: "getSwissVatReturn" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "accountant_package")) return forbidden;
    return swissVatReturn(ctx.tx, ctx.callerIdentity, { ...parsedInput, today: clock.today() });
  });

export const swissVatPeriodsAction = authedAction
  .metadata({ name: "swissVatPeriods" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "accountant_package")) return forbidden;
    const [periods, registrations, payments] = await Promise.all([
      swissVatPeriods(ctx.tx, clock.today()),
      chRegistrations(ctx.tx, ctx.callerIdentity),
      vatPaymentOptions(ctx.tx),
    ]);
    return { data: { periods, registrations, payments } };
  });

export const saveSwissVatManualAction = ownerAction
  .schema(saveManualSchema)
  .metadata({ name: "saveSwissVatManual" })
  .action(async ({ ctx, parsedInput }) =>
    saveManual(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const declareSwissVatAction = ownerAction
  .schema(declareSchema)
  .metadata({ name: "declareSwissVat" })
  .action(async ({ ctx, parsedInput }) =>
    declare(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const undeclareSwissVatAction = ownerAction
  .schema(z.object({ vatRegistrationId: uuid, period }))
  .metadata({ name: "undeclareSwissVat" })
  .action(async ({ ctx, parsedInput }) =>
    undeclare(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const markSwissVatPaidAction = ownerAction
  .schema(markPaidSchema)
  .metadata({ name: "markSwissVatPaid" })
  .action(async ({ ctx, parsedInput }) =>
    markPaid(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const unmarkSwissVatPaidAction = ownerAction
  .schema(z.object({ vatRegistrationId: uuid, period }))
  .metadata({ name: "unmarkSwissVatPaid" })
  .action(async ({ ctx, parsedInput }) =>
    unmarkPaid(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );
