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
export {
  GRAPH_DEFAULT_DEPTH,
  GRAPH_MAX_DEPTH,
  GRAPH_MAX_NODES,
  type GraphOptions,
  neighbourhood,
  nodeKey,
} from "./graph";
export { attachHref, entityHref, graphHref } from "./hrefs";
export { INBOX_LIMIT, type InboxRow, inboxRows, unlinkedDocuments } from "./inbox";
export type {
  CompareCard,
  JustifyInput,
  JustifyKind,
  JustifyResult,
  NoProofInput,
  NoProofReason,
  Reading,
  RowForJustify,
} from "./justify";
export {
  compareRowToReading,
  isCardPurchase,
  justifyRow,
  justifySchema,
  monthOf,
  NO_PROOF_BAS,
  NO_PROOF_REASONS,
  noProofNeeded,
  noProofSchema,
  proposeKind,
} from "./justify";
export { justifyOptions } from "./justify-options";
export { ALLOCATING_KINDS, isKindAllowed, needsOwnFlow, OWN_PAYMENT_FLOW } from "./kinds";
export type { Linkable } from "./linkable";
export {
  _resetLinkables,
  getLinkable,
  listLinkableTypes,
  provideLinkables,
  registerLinkable,
} from "./linkable";
export { createLink, type LinkWriteOptions, removeLink, toLinkDto } from "./linking";
export {
  applySuggestionAction,
  bulkApplyHighAction,
  counterpartyMemoryAction,
  createLinkAction,
  getAllocationStatusAction,
  getLinksForAction,
  getLinksWithLabelsAction,
  graphAction,
  removeLinkAction,
  searchLinkablesAction,
  suggestionsForEntityAction,
  suggestionsForTransactionAction,
} from "./linking.actions";
export { memoryForKeys, memoryForRow, rememberedPartners } from "./memory";
export {
  type ProposeForRowsData,
  proposalJobs,
  proposalSchedules,
  proposeForRows,
  proposeForRowsJob,
} from "./proposals/jobs/propose";
export { familyOf, PREFILL_HIGH, type ProposalFamily } from "./proposals/policy";
export {
  type AcceptResult,
  acceptProposals,
  currentForRows,
  currentProposals,
  dropProposalsFor,
  type ProposalDto,
  type ProposalStats,
  proposalStats,
  type RowFactsForProposals,
  type RunResult,
  rejectProposal,
  runProposals,
} from "./proposals/proposals";
export * from "./proposals/proposals.actions";
export * from "./queries";
export {
  AMBIGUITY_GAP,
  amountTier,
  CROSS_CURRENCY_TOLERANCE,
  confidenceOf,
  dateClaim,
  daysBetween,
  type Memory,
  nameTokens,
  partialTokens,
  type RowFacts,
  rank,
  referenceTokens,
  scoreMatch,
  WEIGHTS,
} from "./scoring";
export {
  type ApplyInput,
  applySuggestion,
  belongs,
  bulkApplyHigh,
  CANDIDATES_PER_TYPE,
  candidateQuery,
  JUSTIFIABLE,
  rowFacts,
  SUGGESTIONS_SHOWN,
  searchLinkables,
  suggestionsForEntity,
  suggestionsForTransaction,
} from "./suggestions";
export type * from "./types";
export { LINK_KINDS } from "./types";
export {
  AFTER_DUE_DAYS,
  BEFORE_ISSUE_DAYS,
  DATED_WINDOW_DAYS,
  EXTRA_CANDIDATES,
  HAS_TERMS,
  inWindow,
  MIN_TERMS_DAYS,
  paymentWindow,
  termsSpan,
} from "./window";
