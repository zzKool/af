// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers).
// The ONLY path other modules and src/app may import for server-side code (constitution §2).

export * from "./keys";
export { nextInSeries } from "./number-series";
export * from "./queries";
export type { SeriesStatus } from "./types";
