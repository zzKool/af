// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions, jobs.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and stores.

export { generateBusinessKey, getDocumentClassification, getUploadKinds } from "./business-key";
export type {
  ArchiveOutcome,
  DocumentFile,
  DocumentFilters,
  DocumentListItem,
  DocumentReviewData,
  DocumentSort,
  DuplicateUploadRef,
  UploadResult,
} from "./documents";
export {
  _resetContainerEnsured,
  ARCHIVE_BULK_MAX,
  archiveDocuments,
  assignBusinessKey,
  classifyDocument,
  contentHashOf,
  deleteDocument,
  documentReaders,
  documentsByIds,
  markDocumentReviewed,
  prepareOcrRerun,
  resolveDocumentData,
  reverseChargeDocumentIds,
  sameContentDocumentIds,
  storeGeneratedDocument,
  unarchiveDocuments,
  updateDocumentCorrections,
  uploadDocument,
} from "./documents";
export type { OcrExtractedData, OcrLineItem } from "./documents.actions";
export {
  archiveDocumentsAction,
  classifyDocumentAction,
  deleteDocumentAction,
  getDocumentDownloadUrlAction,
  getDocumentForReviewAction,
  getDocumentStatsAction,
  getDocumentsAction,
  getRecentDocumentsAction,
  listInboxAction,
  markDocumentReviewedAction,
  runOcrAction,
  unarchiveDocumentsAction,
  updateDocumentCorrectionsAction,
  uploadDocumentAction,
} from "./documents.actions";
export { contentDisposition, type DocumentBytes, documentFile, documentFileUrl } from "./file";
export {
  canArchive,
  duplicateOfMap,
  INBOX_TABS,
  type InboxCounts,
  type InboxState,
  type InboxTab,
  inboxCounts,
  inboxState,
  OCR_STUCK_AFTER_MS,
  PENDING_STATES,
} from "./inbox";
export type { ProcessDocumentData } from "./jobs/process-document";
export {
  documentJobs,
  processDocumentJob,
  setOnDocumentExtracted,
} from "./jobs/process-document";
export { documentLinkable, unlinkedFinancialDocuments } from "./linkable";
export * from "./queries";
// global search (F93): the module's palette hits
export { searchDocumentHits } from "./search";
export { type DocumentState, documentState } from "./state-family";
