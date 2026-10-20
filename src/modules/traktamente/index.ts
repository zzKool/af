// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and actions.

export type { LocalDateTime, PerDiemTrip } from "./calculator";
export {
  ABROAD_MEAL_SHARE,
  computePerDiem,
  countDays,
  DEPARTURE_HALF_FROM_MINUTES,
  HALF_DAY_FACTOR,
  LONG_STAY_FACTORS,
  NO_OVERNIGHT,
  nextDate,
  PerDiemError,
  perDiemDescription,
  perDiemNote,
  RETURN_HALF_UNTIL_MINUTES,
  TENANT_ZONE,
  toLocal,
} from "./calculator";
export type { RenderPerDiemData } from "./jobs/render-per-diem";
export {
  perDiemPrintPath,
  renderPerDiem,
  renderPerDiemJob,
  traktamenteJobs,
} from "./jobs/render-per-diem";
export * from "./queries";
export type { ParsedCsv, ParsedRate, PasteInput, RateInput } from "./rates";
export {
  copyRatesFromYear,
  deleteRate,
  parseSkatteverketCsv,
  pasteSchema,
  pasteSkatteverketCsv,
  rateInputSchema,
  upsertRate,
} from "./rates";
export type { PerDiemStatement } from "./statement";
export { resolvePerDiemStatement } from "./statement";
export * from "./traktamente.actions";
export type { TripInput } from "./trip";
export {
  computeForTrip,
  createOrReplacePerDiemExpense,
  toInstant,
  tripInputSchema,
  upsertTrip,
} from "./trip";
export type * from "./types";
