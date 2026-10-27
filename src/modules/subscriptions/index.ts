// Server surface of the subscriptions module (F94, D57, specs/subscriptions): DTO types, the read API, the services,
// the confirm, the actions, the linkable. The only path other modules and src/app import for server code.
// Never import this file from a client component — use ./ui.
export type {
  ConfirmAllReport,
  ConfirmFacts,
  ConfirmInput,
  ConfirmPrefill,
  ConfirmResult,
} from "./confirm";
export {
  confirm,
  confirmAllExact,
  confirmPrefill,
  confirmSchema,
  periodCandidates,
} from "./confirm";
export type { LoadedSubscription } from "./facts";
export { loadSubscriptions } from "./facts";
export { subscriptionLinkable } from "./linkable";
export { EXACT_PCT } from "./matcher";
export type { SubscriptionPageOptions, SubscriptionVendorOption } from "./page-data";
export { subscriptionPageOptions } from "./page-data";
export { RECEIPT_WINDOW, ROW_WINDOW } from "./periods";
export * from "./queries";
export { searchSubscriptionHits } from "./search";
export type { SubscriptionInput, UpdateSubscriptionInput } from "./subscriptions";
export {
  addPause,
  addPrice,
  createSubscription,
  deleteSubscription,
  detachOccurrence,
  makeRecurring,
  occurrenceIds,
  pauseInputSchema,
  priceInputSchema,
  removePause,
  removePrice,
  subscriptionInputSchema,
  updateSubscription,
  updateSubscriptionSchema,
} from "./subscriptions";
export * from "./subscriptions.actions";
export { ruleFromSubscription, toRule } from "./to-rule";
export type * from "./types";
export { ATTENTION_MARKS, BECOMES, CADENCES, PERIOD_STATES } from "./types";
