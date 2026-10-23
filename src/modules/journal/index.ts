// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and actions.

export { entryHistory } from "./history";
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
} from "./journal";
export {
  categoriseEntryAction,
  createManualEntryAction,
  deleteManualEntryAction,
  distinctJournalValuesAction,
  getJournalEntryAction,
  journalDateHierarchyAction,
  journalEntryHistoryAction,
  linkEntryAction,
  listJournalEntriesAction,
} from "./journal.actions";
export { journalEntryLinkable } from "./linkable";
export { ENTRY_LINK_TARGETS, linkEntry, linkEntrySchema } from "./links";
export { deriveLinksState } from "./links-state";
export { categoryOptions, partnerOptions } from "./options";
export * from "./queries";
export type * from "./types";
export { JOURNAL_FACTS, JOURNAL_SOURCES, LINKS_STATES, RATE_SOURCES } from "./types";
