// The proposal jobs (F98, specs/ai FR-007). After an import commits, its open rows; every night, every tenant's
// open rows (the rows imported before a rule existed, the history that grew since). Stage 1 only in PR 1 — no
// model, no external call; PR 2 adds stage 2 between two short transactions (constitution: never call out
// inside a transaction).
import { randomUUID } from "node:crypto";
import { tenantOwners } from "@/kernel/auth/users";
import { prisma } from "@/kernel/db/client";
import { withJobContext } from "@/kernel/jobs/context";
import type { JobDefinition, ScheduleDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import * as banking from "@/modules/banking";
import { type RunResult, runProposals } from "../proposals";

export type ProposeForRowsData = {
  tenantId: string;
  userId: string;
} & ({ importId: string } | { transactionIds: string[] } | { all: true });

/** One run over one tenant's rows: pick the open rows, then stage 1, in one short transaction. */
export async function proposeForRows(data: ProposeForRowsData): Promise<RunResult> {
  const scope =
    "importId" in data
      ? { importId: data.importId }
      : "transactionIds" in data
        ? { transactionIds: data.transactionIds }
        : { all: true as const };
  const runId = randomUUID();
  const result = await withJobContext(data.tenantId, data.userId, async (tx, caller) => {
    const ids = await banking.proposalRowIds(tx, scope);
    return runProposals(tx, caller, { runId, transactionIds: ids });
  });
  // counts only — never a row, a name or an amount (D51)
  logger.info({ tenantId: data.tenantId, ...result }, "linking.propose: run done");
  return result;
}

export const proposeForRowsJob: JobDefinition<ProposeForRowsData> = {
  name: "linking.propose-for-rows",
  options: { retryLimit: 2, retryDelay: 30, expireInSeconds: 900 },
  handler: async (data) => {
    await proposeForRows(data);
  },
  // a proposal is a convenience: a failed run leaves the rows as they were, the next run (nightly) retries
  onDeadLetter: async (data, ctx) => {
    logger.error(
      { tenantId: data.tenantId, failure: ctx.failure },
      "linking.propose: failed after all retries",
    );
  },
};

export type ProposeNightlyData = Record<string, never>;

/** Every tenant, as its owner: every open row. */
export const proposeNightlyJob: JobDefinition<ProposeNightlyData> = {
  name: "linking.propose-nightly",
  options: { retryLimit: 1, retryDelay: 300, expireInSeconds: 1_800 },
  handler: async () => {
    for (const owner of await tenantOwners(prisma)) {
      try {
        await proposeForRows({ ...owner, all: true });
      } catch (e) {
        // one tenant's failure does not stop the others; the reason is in the log (no data in it)
        logger.error(
          { tenantId: owner.tenantId, error: e instanceof Error ? e.name : "unknown" },
          "linking.propose-nightly: tenant failed",
        );
      }
    }
  },
  onDeadLetter: async (_data, ctx) => {
    logger.error({ failure: ctx.failure }, "linking.propose-nightly: failed after all retries");
  },
};

/** 03:30 Stockholm, every day — after the ECB sync and the backups; a missed night catches up once. */
export const proposeNightlySchedule: ScheduleDefinition<ProposeNightlyData> = {
  job: proposeNightlyJob,
  cron: "30 3 * * *",
  tz: "Europe/Stockholm",
  missed: "once",
};

export const proposalJobs = [proposeForRowsJob, proposeNightlyJob] as const;
export const proposalSchedules = [proposeNightlySchedule] as const;
