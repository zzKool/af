// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions, jobs.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and actions.

export { collectPeriod, countsOf, extensionOf, impliedRate, packageFileName } from "./collect";
export { CSV_HEADER, statementCsv, statementFiles } from "./csv";
export type { BuildDeps, BuildPackageData, Collected } from "./jobs/build-package";
export {
  buildPackage,
  buildPackageJob,
  collectForBuild,
  entriesOf,
  packageJobs,
} from "./jobs/build-package";
export { FLAG_TITLES, notesMd } from "./notes";
export type { BuildRequest } from "./package";
export {
  buildRequestSchema,
  EMPTY_COUNTS,
  markBuilding,
  markBuilt,
  markFailed,
  requestBuild,
  toBuildDto,
} from "./package";
export * from "./package.actions";
export {
  isPackagePeriod,
  lastDayOf,
  monthOf,
  monthsBetween,
  monthsOf,
  parsePeriod,
  periodLabel,
} from "./period";
export * from "./queries";
export { SHEETS, summaryRows, summaryXlsx } from "./summary";
export type * from "./types";
export { FLAG_KINDS, PACKAGE_BUILD_STATUSES } from "./types";
export type { DocumentBytes, ZipEntry } from "./zip";
export {
  monthEntries,
  NOTES_FILE,
  STATEMENTS_DIR,
  SUMMARY_FILE,
  yearEntries,
  zipBytes,
} from "./zip";
