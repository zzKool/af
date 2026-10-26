"use server";

// Server Actions of the subscriptions module (F94, server-action-pattern): reads on `authedAction` +
// `can(read, subscription)` (the accountant reads), every write on `ownerAction`. Thin: the service decides.
import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { listQuerySchema } from "@/kernel/list-query/schema";
import { isoDate, uuid } from "@/kernel/validation/scalars";
import {
  confirm,
  confirmAllExact,
  confirmPrefill,
  confirmSchema,
  periodCandidates,
} from "./confirm";
import {
  distinctSubscriptionValues,
  getSubscriptionDetail,
  listSubscriptions,
  SUBSCRIPTION_COLUMN_KEYS,
  type SubscriptionColumn,
  subscriptionDateHierarchy,
} from "./queries";
import * as service from "./subscriptions";
import type { SubscriptionDetailWire } from "./types";

const clock = createClock();
const forbidden = {
  error: {
    code: "FORBIDDEN" as const,
    message: "Not allowed to read subscriptions",
    retryable: false,
  },
};
const columnSchema = z.enum(
  SUBSCRIPTION_COLUMN_KEYS as [SubscriptionColumn, ...SubscriptionColumn[]],
);
const dateColumn = z.enum(["startDate", "endDate", "nextDate"]);

// --- reads ---

export const listSubscriptionsAction = authedAction
  .schema(z.object({ query: listQuerySchema }))
  .metadata({ name: "listSubscriptions" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "subscription")) return forbidden;
    return {
      data: await listSubscriptions(ctx.tx, ctx.callerIdentity, parsedInput.query, clock.today()),
    };
  });

export const distinctSubscriptionsAction = authedAction
  .schema(z.object({ query: listQuerySchema, column: columnSchema }))
  .metadata({ name: "distinctSubscriptions" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "subscription")) return forbidden;
    return {
      data: await distinctSubscriptionValues(
        ctx.tx,
        ctx.callerIdentity,
        parsedInput.column,
        parsedInput.query,
        clock.today(),
      ),
    };
  });

export const subscriptionDateHierarchyAction = authedAction
  .schema(z.object({ query: listQuerySchema, column: dateColumn }))
  .metadata({ name: "subscriptionDateHierarchy" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "subscription")) return forbidden;
    return {
      data: await subscriptionDateHierarchy(
        ctx.tx,
        ctx.callerIdentity,
        parsedInput.column,
        parsedInput.query,
        clock.today(),
      ),
    };
  });

export const getSubscriptionAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "getSubscription" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "subscription")) return forbidden;
    const r = await getSubscriptionDetail(
      ctx.tx,
      ctx.callerIdentity,
      parsedInput.id,
      clock.today(),
    );
    if (r.error) return { error: r.error };
    const wire: SubscriptionDetailWire = {
      ...r.data,
      subscription: {
        ...r.data.subscription,
        createdAt: r.data.subscription.createdAt.toISOString(),
        updatedAt: r.data.subscription.updatedAt.toISOString(),
      },
    };
    return { data: wire };
  });

const periodRef = z.object({
  subscriptionId: uuid,
  periodDate: isoDate,
  bankTransactionId: uuid.optional(),
  documentId: uuid.optional(),
});

export const confirmPrefillAction = authedAction
  .schema(periodRef)
  .metadata({ name: "subscriptionConfirmPrefill" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "subscription")) return forbidden;
    return confirmPrefill(ctx.tx, ctx.callerIdentity, parsedInput, clock.today());
  });

export const periodCandidatesAction = authedAction
  .schema(z.object({ subscriptionId: uuid, periodDate: isoDate }))
  .metadata({ name: "subscriptionPeriodCandidates" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "subscription")) return forbidden;
    return periodCandidates(ctx.tx, ctx.callerIdentity, parsedInput, clock.today());
  });

// --- writes (owner) ---

export const createSubscriptionAction = ownerAction
  .schema(service.subscriptionInputSchema)
  .metadata({ name: "createSubscription" })
  .action(async ({ ctx, parsedInput }) =>
    service.createSubscription(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const updateSubscriptionAction = ownerAction
  .schema(z.object({ id: uuid, patch: service.updateSubscriptionSchema }))
  .metadata({ name: "updateSubscription" })
  .action(async ({ ctx, parsedInput }) =>
    service.updateSubscription(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
      parsedInput.patch,
    ),
  );

export const deleteSubscriptionAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteSubscription" })
  .action(async ({ ctx, parsedInput }) =>
    service.deleteSubscription(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

export const addSubscriptionPriceAction = ownerAction
  .schema(service.priceInputSchema)
  .metadata({ name: "addSubscriptionPrice" })
  .action(async ({ ctx, parsedInput }) =>
    service.addPrice(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const removeSubscriptionPriceAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "removeSubscriptionPrice" })
  .action(async ({ ctx, parsedInput }) =>
    service.removePrice(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

export const addSubscriptionPauseAction = ownerAction
  .schema(service.pauseInputSchema)
  .metadata({ name: "addSubscriptionPause" })
  .action(async ({ ctx, parsedInput }) =>
    service.addPause(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput, clock.today()),
  );

export const removeSubscriptionPauseAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "removeSubscriptionPause" })
  .action(async ({ ctx, parsedInput }) =>
    service.removePause(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

export const makeRecurringAction = ownerAction
  .schema(
    z.object({
      entity: z.object({ type: z.enum(["expense", "supplier_invoice"]), id: uuid }),
      subscription: service.subscriptionInputSchema,
    }),
  )
  .metadata({ name: "makeSubscriptionRecurring" })
  .action(async ({ ctx, parsedInput }) =>
    service.makeRecurring(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const confirmPeriodAction = ownerAction
  .schema(confirmSchema)
  .metadata({ name: "confirmSubscriptionPeriod" })
  .action(async ({ ctx, parsedInput }) =>
    confirm(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput, clock.today()),
  );

export const confirmAllExactAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "confirmAllExactSubscriptionPeriods" })
  .action(async ({ ctx }) => confirmAllExact(ctx.tx, ctx.callerIdentity, ctx.audit, clock.today()));

/** *Detach* (FR-005): the entity stops being this subscription's period — the link goes, the entity stays. */
export const detachOccurrenceAction = ownerAction
  .schema(
    z.object({
      subscriptionId: uuid,
      entity: z.object({ type: z.enum(["expense", "supplier_invoice"]), id: uuid }),
    }),
  )
  .metadata({ name: "detachSubscriptionOccurrence" })
  .action(async ({ ctx, parsedInput }) =>
    service.detachOccurrence(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );
