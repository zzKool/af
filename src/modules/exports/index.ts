// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and actions.

export type { DeclareInput, MarkPaidInput, SaveManualInput } from "./declarations";
export {
  declare,
  declareSchema,
  getDeclaration,
  listDeclarations,
  markPaid,
  markPaidSchema,
  saveManual,
  saveManualSchema,
  toDeclarationDto,
  undeclare,
  unmarkPaid,
} from "./declarations";
export * from "./exports.actions";
export { isSwissVatPeriod, periodOfDate } from "./period";
export * from "./queries";
export type { ComputeInput, FormField } from "./swiss-vat";
export {
  computeSwissVatReturn,
  csvFileName,
  FORM_FIELDS,
  isManualRef,
  quarterBounds,
  quartersBetween,
  rateKey,
  swissVatCsv,
} from "./swiss-vat";
export type * from "./types";
export { MANUAL_REFS, SWISS_VAT_REFS } from "./types";
