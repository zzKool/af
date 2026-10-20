// Read API of the module — the functions pages and other modules may call for data.
// 3b/3d: declared here as named re-exports; extraction into standalone query implementations
// (ListQuery, distinct values for DataTable headers) happens with the partners reference slice.

export { getDocumentTypePrefixes, isPrefixesSeeded } from "./document-type-prefixes";
export {
  getDocument,
  getDocumentDownloadUrl,
  getDocumentFilterOptions,
  getDocumentForReview,
  getDocumentOcrData,
  getDocumentStats,
  getDocuments,
  getRecentDocuments,
} from "./documents";
