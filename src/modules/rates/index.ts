// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions, jobs.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and stores.

export type {
  BaseRateResult,
  DateGap,
  EcbRateFetchResult,
  RateLookupResult,
  RateSource,
} from "./ecb-rates";
export { countWeekdaysBetween, fetchDailyRates, rateStatus } from "./ecb-rates";
export type { EcbSyncData } from "./jobs/ecb-sync";
export {
  ecbSyncJob,
  ecbSyncSchedule,
  observationsToFetch,
  rateJobs,
  rateSchedules,
} from "./jobs/ecb-sync";
export * from "./queries";
export { fetchRatesNowAction, ratesStatusAction } from "./rates.actions";
export type * from "./types";
