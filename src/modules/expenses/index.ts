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
export type { AttachInput, ExpenseInput, PerDiemInput, UpdateExpenseInput } from "./expenses";
export {
  attachBankTransaction,
  attachSchema,
  baseAmount,
  createExpense,
  createPerDiemExpense,
  deleteExpense,
  detachBankTransaction,
  duplicateAckSchema,
  expenseInputSchema,
  isExpenseOpen,
  noteWithAck,
  perDiemInputSchema,
  replacePerDiemExpense,
  updateExpense,
  updateExpenseSchema,
} from "./expenses";
export * from "./expenses.actions";
export type { Difference, FifoLine, OpenExpense } from "./fifo";
export { fifoAllocate, fifoOrder, residualOpen, roundingNote, settlementDifference } from "./fifo";
export type { GroupInput, UpdateGroupInput } from "./groups";
export {
  createGroup,
  deleteGroup,
  EXPENSE_GROUP_SERIES,
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
export { expenseLinkable, settlementLinkable } from "./linkable";
export type { ExpensePageOptions } from "./page-data";
export { expenseCategoryOptions, expensePageOptions } from "./page-data";
export type { PaymentSourceInput } from "./payment-sources";
export {
  createPaymentSource,
  ensureDefaultSources,
  paymentSourceInputSchema,
  setPaymentSourceActive,
} from "./payment-sources";
export * from "./queries";
export type { ConfirmInput, ProposeInput } from "./settlements";
export {
  activeSettlementTransactionIds,
  cancelSettlement,
  confirmSchema,
  confirmSettlement,
  proposeSchema,
} from "./settlements";
export type { StatementData, StatementLine } from "./statement";
export { deriveExpenseStatus, OPEN_BASE_TOLERANCE_SEK, openBase, owedBase } from "./status";
export type * from "./types";
export {
  EXPENSE_GROUP_KINDS,
  EXPENSE_KINDS,
  EXPENSE_RATE_SOURCES,
  EXPENSE_STATUSES,
  PAYMENT_SOURCE_KINDS,
  SETTLEMENT_STATUSES,
} from "./types";
