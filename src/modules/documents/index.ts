// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions, jobs.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and stores.

export { generateBusinessKey, getDocumentClassification, getUploadKinds } from "./business-key";
export type {
  DocumentFilters,
  DocumentListItem,
  DocumentReviewData,
  DocumentSort,
} from "./documents";
export {
  _resetContainerEnsured,
  assignBusinessKey,
  classifyDocument,
  deleteDocument,
  markDocumentReviewed,
  refreshSignedUrl,
  resolveDocumentData,
  storeGeneratedDocument,
  updateDocumentCorrections,
  uploadDocument,
} from "./documents";
export type { OcrExtractedData, OcrLineItem } from "./documents.actions";
export {
  classifyDocumentAction,
  deleteDocumentAction,
  getDocumentDownloadUrlAction,
  getDocumentFilterOptionsAction,
  getDocumentForReviewAction,
  getDocumentStatsAction,
  getDocumentsAction,
  getRecentDocumentsAction,
  markDocumentReviewedAction,
  refreshSignedUrlAction,
  updateDocumentCorrectionsAction,
  uploadDocumentAction,
} from "./documents.actions";
export type { ProcessDocumentData } from "./jobs/process-document";
export { documentJobs, processDocumentJob } from "./jobs/process-document";
export { documentLinkable } from "./linkable";
export * from "./queries";
