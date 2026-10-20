// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions, jobs.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and stores.

export { generateBusinessKey, getDocumentClassification } from "./business-key";
export {
  createDocumentTypePrefix,
  deleteDocumentTypePrefix,
  documentTypeSchema,
  getDocumentTypePrefixesWithSeed,
  prefixSchema,
  seedDocumentTypePrefixes,
  updateDocumentTypePrefix,
} from "./document-type-prefixes";
export {
  createDocumentTypePrefixAction,
  deleteDocumentTypePrefixAction,
  getDocumentTypePrefixesAction,
  updateDocumentTypePrefixAction,
} from "./document-type-prefixes.actions";
export type {
  DocumentFilters,
  DocumentListItem,
  DocumentReviewData,
  DocumentSort,
} from "./documents";
export {
  _resetContainerEnsured,
  classifyDocument,
  deleteDocument,
  markDocumentReviewed,
  refreshSignedUrl,
  resolveDocumentData,
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
export * from "./jobs/process-document";
export * from "./queries";
