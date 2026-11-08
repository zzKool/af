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
export { CARD_SETTLE_DAYS, type CheckProofInput, checkProof, warningMessage } from "./check-proof";
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
  ProposedPartner,
  Reading,
  RowForJustify,
  VendorRuleDraft,
} from "./justify";
export {
  compareRowToReading,
  isCardPurchase,
  justifyRow,
  justifySchema,
  monthOf,
  NO_PROOF_BAS,
  NO_PROOF_REASONS,
  NO_PROOF_REASONS_INCOMING,
  noProofNeeded,
  noProofSchema,
  PARTNER_REQUIRED,
  proposedPartnerRole,
  proposeKind,
  proposeVendorRule,
} from "./justify";
export { justifyOptions } from "./justify-options";
export {
  DEFAULT_PAPER,
  type GreenCheck,
  greenChecks,
  PAPERS,
  type Paper,
  paperOfPrefixType,
  prefixTypeOfPaper,
} from "./justify-rules";
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
  proofFactsAction,
  removeLinkAction,
  searchLinkablesAction,
  suggestionsForEntityAction,
  suggestionsForTransactionAction,
} from "./linking.actions";
export { memoryForKeys, memoryForRow, rememberedPartners } from "./memory";
export { type ProofFactsInput, proofFacts } from "./proof-facts";
export {
  currentDocumentProposals,
  decideDocumentProposal,
  documentBasHints,
  dropProposalsForDocuments,
} from "./proposals/documents";
export {
  type ProposeForDocumentsData,
  type ProposeForRowsData,
  proposalJobs,
  proposalSchedules,
  proposeForDocuments,
  proposeForDocumentsJob,
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
  type AcceptMatchInput,
  acceptMatch,
  bankFxCost,
  type DoneLink,
  defaultReconcileMonth,
  doneToday,
  type FxView,
  RECONCILE_GROUPS,
  type ReconcileData,
  type ReconcileGroup,
  type ReconcileRow,
  reconcileData,
  reconcileGroup,
  type StageField,
  stageFields,
  twinsOf,
} from "./reconcile";
export {
  AMBIGUITY_GAP,
  amountTier,
  CROSS_CURRENCY_TOLERANCE,
  confidenceOf,
  dateClaim,
  daysBetween,
  type Memory,
  nameInTexts,
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
export { LINK_KINDS, WARNING_CODES } from "./types";
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
