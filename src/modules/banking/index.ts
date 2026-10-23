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
export { dedupHash, headerError, parse, validateFormat } from "./csv-parser";
export {
  deleteImport,
  describeHeaderError,
  formatConfig,
  importCsv,
  importCsvSchema,
  planImport,
  statementKey,
} from "./import";
export { bankTransactionLinkable } from "./linkable";
export type { MonthsInput } from "./months";
export {
  addMonths,
  assembleMonths,
  bankMonths,
  linkFactsOf,
  MONTHS_WINDOW,
  monthRange,
  needsProof,
} from "./months";
export * from "./queries";
export type { EntryTarget, RuleInput, RuleLike, UpdateRuleInput } from "./rules";
export {
  applyRules,
  applyToEntries,
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
  RULE_MATCH_FIELDS,
  RULE_MATCH_TYPES,
  TRANSACTION_STATES,
} from "./types";
