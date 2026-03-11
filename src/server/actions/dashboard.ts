"use server";

import { z } from "zod/v4";
import { prisma } from "@/server/db/client";
import { authedAction } from "@/server/middleware/action-client";
import * as dashboardService from "@/server/services/dashboard";

/**
 * Fetch dashboard data — authedAction (not ownerAction — accountant needs access too).
 * Uses dual Prisma client: base `prisma` for auth tables, `ctx.tx` for tenant-scoped data.
 */
export const getDashboardData = authedAction.schema(z.object({})).action(async ({ ctx }) => {
  return dashboardService.getDashboardData(prisma, ctx.tx, ctx.callerIdentity);
});
