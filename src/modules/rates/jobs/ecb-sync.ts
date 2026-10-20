import { prisma } from "@/kernel/db/client";
import type { JobDefinition, ScheduleDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import { countWeekdaysBetween, fetchDailyRates } from "../ecb-rates";

export interface EcbSyncData {
  /** Force a fixed window of observations; otherwise sized from the gap since the last stored rate. */
  lastN?: number;
}

const FIRST_RUN_OBSERVATIONS = 30;
const MIN_OBSERVATIONS = 5;
const MAX_OBSERVATIONS = 400;

async function latestStoredDate(): Promise<Date | null> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT max(date)::text AS latest FROM ecb_rates`,
  )) as Array<{ latest: string | null }>;
  const latest = rows[0]?.latest;
  return latest ? new Date(latest) : null;
}

/**
 * How many ECB observations to ask for so that one run closes the gap since the last stored rate —
 * after weeks scaled to zero, the single catch-up run (`missed: "once"`) refills everything.
 */
export function observationsToFetch(latest: Date | null, today: Date): number {
  if (!latest) return FIRST_RUN_OBSERVATIONS;
  const missingWeekdays = countWeekdaysBetween(latest, today) + 2;
  return Math.min(MAX_OBSERVATIONS, Math.max(MIN_OBSERVATIONS, missingWeekdays));
}

/** Daily ECB reference rates (EUR/SEK, EUR/CHF, …) — global, no tenant; duplicates are skipped. */
export const ecbSyncJob: JobDefinition<EcbSyncData> = {
  name: "rates.ecb-sync",
  options: { retryLimit: 3, retryDelay: 120, retryBackoff: true, expireInSeconds: 120 },
  handler: async (data) => {
    const lastN = data.lastN ?? observationsToFetch(await latestStoredDate(), new Date());
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
