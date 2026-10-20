// Server surface of the linking module (constitution §2, D18).
// Importing it registers every module's linkable (see ./linkables).
import "./linkables";

export {
  canAllocate,
  isSettled,
  remaining,
  settlementTolerance,
  sumAllocations,
} from "./allocation";
export { ALLOCATING_KINDS, isKindAllowed } from "./kinds";
export type { Linkable } from "./linkable";
export {
  _resetLinkables,
  getLinkable,
  listLinkableTypes,
  provideLinkables,
  registerLinkable,
} from "./linkable";
export { createLink, removeLink, toLinkDto } from "./linking";
export {
  applySuggestionAction,
  bulkApplyHighAction,
  createLinkAction,
  getAllocationStatusAction,
  getLinksForAction,
  getLinksWithLabelsAction,
  removeLinkAction,
  searchLinkablesAction,
  suggestionsForEntityAction,
  suggestionsForTransactionAction,
} from "./linking.actions";
export * from "./queries";
export {
  AMBIGUITY_GAP,
  CROSS_CURRENCY_TOLERANCE,
  confidenceOf,
  daysBetween,
  partialTokens,
  type RowFacts,
  rank,
  scoreMatch,
  WEIGHTS,
} from "./scoring";
export {
  type ApplyInput,
  applySuggestion,
  bulkApplyHigh,
  CANDIDATES_PER_TYPE,
  DATE_WINDOW_DAYS,
  DEFAULT_WINDOW_DAYS,
  JUSTIFIABLE,
  rowFacts,
  SUGGESTIONS_SHOWN,
  searchLinkables,
  suggestionsForEntity,
  suggestionsForTransaction,
} from "./suggestions";
export type * from "./types";
export { LINK_KINDS } from "./types";
