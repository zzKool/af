// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions, jobs.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and actions.

export {
  createdFromTwins,
  DUPLICATE_AMOUNT_TOLERANCE,
  DUPLICATE_DATE_TOLERANCE_DAYS,
  DUPLICATE_MAX,
  dedupeMatches,
  type ExpenseDuplicateQuery,
  findExpenseDuplicates,
  foldName,
  isNear,
} from "./duplicates";
export type {
  ExpenseInput,
  PayInput,
  PerDiemInput,
  UnpayInput,
  UpdateExpenseInput,
} from "./expenses";
export {
  attachDocument,
  baseAmount,
  createExpense,
  createPerDiemExpense,
  deleteExpense,
  detachDocument,
  duplicateAckSchema,
  expenseInputSchema,
  isExpenseOpen,
  noteWithAck,
  payExpense,
  paySchema,
  perDiemInputSchema,
  replacePerDiemExpense,
  unpayExpense,
  unpaySchema,
  updateExpense,
  updateExpenseSchema,
} from "./expenses";
export * from "./expenses.actions";
export type { FifoLine, OpenExpense } from "./fifo";
export { fifoAllocate, fifoOrder, residualOpen } from "./fifo";
export type { GroupInput, UpdateGroupInput } from "./groups";
export {
  createGroup,
  deleteGroup,
  groupInputSchema,
  groupLabel,
  updateGroup,
  updateGroupSchema,
} from "./groups";
export type { Renderer, RenderStatementData } from "./jobs/render-statement";
export {
  expenseJobs,
  renderStatement,
  renderStatementJob,
  statementPrintPath,
} from "./jobs/render-statement";
export { expenseLinkable } from "./linkable";
export type { ExpensePageOptions } from "./page-data";
export { expenseCategoryOptions, expensePageOptions, vendorOptions } from "./page-data";
export { partnerBasUsage } from "./partner-bas-usage";
export * from "./queries";
// global search (F93): the module's palette hits
export { searchExpenseHits, searchSettlementHits } from "./search";
export type { ConfirmInput, ProposeInput } from "./settlements";
export {
  activeSettlementTransactionIds,
  amountForBase,
  cancelSettlement,
  confirmSchema,
  confirmSettlement,
  differenceBasCode,
  expectedBaseFor,
  proposeSchema,
  settlementTotals,
} from "./settlements";
export type { StatementData, StatementLine } from "./statement";
export { deriveExpenseStatus, openBase, openOn } from "./status";
export type * from "./types";
export {
  EXPENSE_GROUP_KINDS,
  EXPENSE_KINDS,
  EXPENSE_RATE_SOURCES,
  EXPENSE_STATUSES,
  PAYER_KINDS,
  SETTLEMENT_STATUSES,
} from "./types";
