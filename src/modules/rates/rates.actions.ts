"use server";

// Server Actions of the rates module (server-action-pattern): the status is read by anyone signed in (the table
// is global, no tenant data); *Fetch now* is the owner's and only queues the sync job — the job does the fetch.
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { enqueue } from "@/kernel/jobs/queue";
import { rateStatus } from "./ecb-rates";
import { catchUpWindow, ecbSyncJob } from "./jobs/ecb-sync";

const clock = createClock();
/** One manual fetch in flight at a time — a second click while it runs is told so, not queued twice. */
const MANUAL_KEY = "rates.ecb-sync.manual";

export const ratesStatusAction = authedAction
  .metadata({ name: "ratesStatus" })
  .action(async () => ({ data: await rateStatus(prisma, clock.today()) }));

export const fetchRatesNowAction = ownerAction
  .metadata({ name: "fetchRatesNow" })
  .action(async () => {
    const lastN = await catchUpWindow(clock.today());
    const jobId = await enqueue(ecbSyncJob, { lastN }, { singletonKey: MANUAL_KEY });
    return { data: { queued: jobId !== null, lastN } };
  });
