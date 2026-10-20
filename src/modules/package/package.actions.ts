"use server";

// Server Actions of the package module (server-action-pattern): the owner requests a build (queued, the job
// enqueued once committed); owner and accountant read the builds and the live preview of a period.
import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { enqueue } from "@/kernel/jobs/queue";
import { buildPackageJob } from "./jobs/build-package";
import { buildRequestSchema, requestBuild } from "./package";
import { isPackagePeriod } from "./period";
import { getBuild, listBuilds, livePreview } from "./queries";

const clock = createClock();
const forbidden = {
  error: {
    code: "FORBIDDEN" as const,
    message: "Only the owner and the accountant see packages",
    retryable: false,
  },
};

export const buildPackageAction = ownerAction
  .schema(buildRequestSchema)
  .metadata({ name: "buildPackage" })
  .action(async ({ ctx, parsedInput }) => {
    const result = await requestBuild(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
    if (result.data) {
      const { tenantId, userId } = ctx.callerIdentity;
      const buildId = result.data.id;
      ctx.onCommit(async () => {
        await enqueue(buildPackageJob, { tenantId, userId, buildId }, { singletonKey: buildId });
      });
    }
    return result;
  });

export const listPackageBuildsAction = authedAction
  .metadata({ name: "listPackageBuilds" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "accountant_package")) return forbidden;
    return { data: await listBuilds(ctx.tx) };
  });

export const getPackageBuildAction = authedAction
  .schema(z.object({ id: z.string().uuid() }))
  .metadata({ name: "getPackageBuild" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "accountant_package")) return forbidden;
    return { data: await getBuild(ctx.tx, parsedInput.id) };
  });

export const packagePreviewAction = authedAction
  .schema(z.object({ period: z.string().refine(isPackagePeriod, "Expected YYYY-MM or YYYY") }))
  .metadata({ name: "packagePreview" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "accountant_package")) return forbidden;
    return { data: await livePreview(ctx.tx, parsedInput.period, clock.today()) };
  });
