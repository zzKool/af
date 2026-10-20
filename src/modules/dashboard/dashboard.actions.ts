"use server";

import { z } from "zod/v4";
import { authedAction } from "@/kernel/actions/action-client";
import { prisma } from "@/kernel/db/client";
import * as dashboardService from "@/modules/dashboard/dashboard";

/**
 * Fetch dashboard data — authedAction (not ownerAction — accountant needs access too).
 * Uses dual Prisma client: base `prisma` for auth tables, `ctx.tx` for tenant-scoped data.
 */
export const getDashboardDataAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "getDashboardData" })
  .action(async ({ ctx }) => {
    return dashboardService.getDashboardData(prisma, ctx.tx, ctx.callerIdentity);
  });
