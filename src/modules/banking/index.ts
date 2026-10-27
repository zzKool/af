// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and actions.

export { detectAccountFromFilename, pickAccount } from "./account-detect";
export {
  accountLabel,
  createBankAccount,
  deleteBankAccount,
  updateBankAccount,
} from "./bank-accounts";
export {
  createBankAccountAction,
  deleteBankAccountAction,
  getBankAccountsAction,
  getBankFormatsAction,
  updateBankAccountAction,
} from "./bank-accounts.actions";
export * from "./banking.actions";
export { counterpartyKey, stripCardPrefix } from "./counterparty";
export type {
  BankFormatColumn,
  BankFormatConfig,
  ParsedRow,
  ParseResult,
  ValidationResult,
} from "./csv-parser";
export { dedupHash, headerError, parse, parseColumnMapping, validateFormat } from "./csv-parser";
export type { CategoriseOptions, RowRate } from "./facts";
export {
  baseAmount,
  categorise,
  categoriseSchema,
  resolveRate,
  transactionFacts,
  transactionIdsByAmount,
} from "./facts";
export { transactionHistory } from "./history";
export { impliedRate, withImplicitRates } from "./implicit-rate";
export {
  deleteImport,
  describeHeaderError,
  formatConfig,
  importCsv,
  importCsvSchema,
  planImport,
} from "./import";
export { linkFactsOf, type RowForFacts } from "./link-facts";
export { bankTransactionLinkable } from "./linkable";
export type { MonthsInput } from "./months";
export {
  addMonths,
  assembleMonths,
  bankMonths,
  MONTHS_WINDOW,
  monthRange,
  needsProof,
} from "./months";
export { rowsToJustifyCount } from "./open-work";
export { categoryOptions, partnerOptions } from "./options";
export {
  createPrivateAccount,
  type PayerAccount,
  type PrivateAccountInput,
  payerAccount,
  payerAccounts,
  privateAccountSchema,
} from "./payers";
export * from "./queries";
export type { RuleInput, RuleLike, RuleTarget, UpdateRuleInput } from "./rules";
export {
  applyRules,
  applyToTransactions,
  createRule,
  createRuleFromTransaction,
  DEFAULT_RULES,
  deleteRule,
  ensureDefaultRules,
  fieldText,
  firstHit,
  matchRule,
  orderRules,
  regexError,
  ruleInputSchema,
  testRule,
  testRuleSchema,
  updateRule,
  updateRuleSchema,
} from "./rules";
// global search (F93): the module's palette hits
export { searchBankTransactionHits } from "./search";
export type { TransferLeg } from "./transfer-pairs";
export {
  acceptTransfer,
  MAX_DATE_GAP_DAYS,
  MAX_RATE_DEVIATION,
  transferCandidates,
} from "./transfer-pairs";
export type * from "./types";
export {
  BANK_ACCOUNT_ROLES,
  payerKindOf,
  RATE_SOURCES,
  RULE_MATCH_FIELDS,
  RULE_MATCH_TYPES,
  STATEMENT_ROLES,
  TRANSACTION_STATES,
} from "./types";
