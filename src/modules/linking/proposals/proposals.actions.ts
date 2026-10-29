"use server";

// The proposals' actions (F98, specs/ai FR-008): reads for the owner and the accountant, the decisions and
// *Run now* for the owner only. Never throw — the action client turns a RollbackError into its AppError.
import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { aiStatus } from "@/kernel/ai/ai";
import { enqueue } from "@/kernel/jobs/queue";
import { uuid } from "@/kernel/validation/scalars";
import "../linkables";
import { proposeForRowsJob } from "./jobs/propose";
import { acceptProposals, currentProposals, proposalStats, rejectProposal } from "./proposals";

/** The current proposals of these rows — the panel, the inbox's right pane. */
export const getProposalsAction = authedAction
  .schema(z.object({ transactionIds: z.array(uuid).min(1).max(200) }))
  .metadata({ name: "getProposals" })
  .action(async ({ ctx, parsedInput }) => {
    const map = await currentProposals(ctx.tx, parsedInput.transactionIds);
    return { data: Object.fromEntries(map) };
  });

export const acceptProposalsAction = ownerAction
  .schema(
    z.object({
      transactionId: uuid,
      proposalIds: z.array(uuid).max(4).optional(),
      overrideBasCode: z
        .string()
        .regex(/^\d{3,4}$/)
        .nullable()
        .optional(),
    }),
  )
  .metadata({ name: "acceptProposals" })
  .action(async ({ ctx, parsedInput }) => {
    const r = await acceptProposals(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
    if (r.error) return { error: r.error };
    return {
      data: {
        transactionId: r.data.transaction.id,
        basCode: r.data.transaction.basCode,
        partnerId: r.data.transaction.partnerId,
        accepted: r.data.accepted,
        proposeRule: r.data.proposeRule,
      },
    };
  });

export const rejectProposalAction = ownerAction
  .schema(z.object({ proposalId: uuid }))
  .metadata({ name: "rejectProposal" })
  .action(async ({ ctx, parsedInput }) =>
    rejectProposal(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

/** Settings → AI's *Run now*: every open row of the tenant, queued after the commit. */
export const runProposalsNowAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "runProposalsNow" })
  .action(async ({ ctx }) => {
    const { tenantId, userId } = ctx.callerIdentity;
    ctx.onCommit(async () => {
      await enqueue(proposeForRowsJob, { tenantId, userId, all: true });
    });
    return { data: { queued: true } };
  });

/** Settings → AI: the endpoint's state (no prompt, no answer) and the acceptance counts of 30 and 90 days. */
export const getAiOverviewAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getAiOverview" })
  .action(async ({ ctx }) => {
    const status = await aiStatus();
    const last30 = await proposalStats(ctx.tx, 30);
    const last90 = await proposalStats(ctx.tx, 90);
    return { data: { status, last30, last90 } };
  });
