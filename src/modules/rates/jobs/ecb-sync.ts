import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import type { JobDefinition, ScheduleDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import { countWeekdaysBetween, fetchDailyRates, rateStatus } from "../ecb-rates";

export interface EcbSyncData {
  /** Force a fixed window of observations; otherwise sized from the pair furthest behind. */
  lastN?: number;
}

const FIRST_RUN_OBSERVATIONS = 30;
const MIN_OBSERVATIONS = 5;
const MAX_OBSERVATIONS = 400;

const clock = createClock();

/**
 * How many ECB observations to ask for so that one run closes the gap since the last stored rate —
 * after weeks scaled to zero, the single catch-up run (`missed: "once"`) refills everything. ISO days (the
 * Stockholm day from the clock), never Date instants: the server's time zone cannot shift a weekend (audit 28).
 */
export function observationsToFetch(latest: string | null, today: string): number {
  if (!latest) return FIRST_RUN_OBSERVATIONS;
  const missingWeekdays = countWeekdaysBetween(latest, today) + 2;
  return Math.min(MAX_OBSERVATIONS, Math.max(MIN_OBSERVATIONS, missingWeekdays));
}

/**
 * One run's window, sized from the pair furthest behind (T001): the newest stored day **per pair**, so a pair
 * that missed a run while another was stored (a partial ECB answer, a pair added later) is refilled too.
 * A pair never stored counts as a first run.
 */
export function catchUpObservations(
  newestPerPair: ReadonlyArray<string | null>,
  today: string,
): number {
  if (newestPerPair.length === 0) return FIRST_RUN_OBSERVATIONS;
  return Math.max(...newestPerPair.map((d) => observationsToFetch(d, today)));
}

/** The catch-up window now: the newest stored day of each fetched pair, against the Stockholm day. */
export async function catchUpWindow(today: string = clock.today()): Promise<number> {
  const status = await rateStatus(prisma, today);
  return catchUpObservations(
    status.map((s) => s.latestDate),
    today,
  );
}

/** Daily ECB reference rates (EUR/SEK, EUR/CHF, …) — global, no tenant; duplicates are skipped. */
export const ecbSyncJob: JobDefinition<EcbSyncData> = {
  name: "rates.ecb-sync",
  options: { retryLimit: 3, retryDelay: 120, retryBackoff: true, expireInSeconds: 120 },
  // F110: no entity to mark — the failure is a health fact (`failedJobs`) and the dashboard's missing-rate
  // to-do shows the gap; the next scheduled run catches up
  onDeadLetter: async (data, ctx) => {
    logger.error(
      { lastN: data.lastN, failure: ctx.failure },
      "rates.ecb-sync: failed after all retries",
    );
  },
  handler: async (data) => {
    const lastN = data.lastN ?? (await catchUpWindow());
    const result = await fetchDailyRates(prisma, { lastN });
    logger.info({ lastN, inserted: result.inserted, skipped: result.skipped }, "ECB sync done");
  },
};

/** Weekdays at 16:30 Stockholm time — the ECB publishes around 16:00 CET. Missed days catch up once. */
export const ecbSyncSchedule: ScheduleDefinition<EcbSyncData> = {
  job: ecbSyncJob,
  cron: "30 16 * * 1-5",
  tz: "Europe/Stockholm",
  missed: "once",
};

export const rateJobs = [ecbSyncJob] as const;
export const rateSchedules = [ecbSyncSchedule] as const;
