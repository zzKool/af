// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and actions.

export type { CategoriseOptions, ManualEntryInput } from "./journal";
export {
  bankEntrySchema,
  baseAmount,
  categorise,
  categoriseSchema,
  createBankEntries,
  createManualEntry,
  deleteBySource,
  deleteManualEntry,
  manualEntrySchema,
  resolveRate,
  setBankImplicitRate,
} from "./journal";
export {
  categoriseEntryAction,
  createManualEntryAction,
  deleteManualEntryAction,
  distinctJournalValuesAction,
  getJournalEntryAction,
  journalDateHierarchyAction,
  listJournalEntriesAction,
} from "./journal.actions";
export { journalEntryLinkable } from "./linkable";
export * from "./queries";
export type * from "./types";
export { JOURNAL_SOURCES, RATE_SOURCES } from "./types";
