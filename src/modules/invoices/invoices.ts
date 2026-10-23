// Invoices service — quotes, invoices, credit notes (specs/invoices/spec.md, D7, D21, D22, D23).
// Drafts are editable; `issue` numbers, converts, snapshots and locks in ONE transaction; after that only
// hand-set facts change (sent, quote decision, declaration period override). Everything else is derived
// in queries.ts. MUST NOT import from next/* or src/components/*.
//
// One file per section — this file only gathers them, so `./invoices` keeps meaning "the services" for
// index.ts, the actions and the tests. Named re-exports: what the parts share with each other stays inside.
//   drafts ──► issue ──► hand-set-facts          copies (convert a quote, copy, credit note)
//   schemas (the boundary) · dto (row → DTO, load) · defaults (defaults chain, line rows, totals) · errors
export { convertQuote, copyToDraft, createCreditNote } from "./copies";
export { dueDateFor } from "./defaults";
export { createDraft, deleteDraft, updateDraft } from "./drafts";
export { toInvoiceDto, toLineDto } from "./dto";
export { decideQuote, markSent, setDeclarationPeriod } from "./hand-set-facts";
export { issue } from "./issue";
export type {
  CreateDraftInput,
  CreditNoteInput,
  IssueInput,
  LineInputDto,
  UpdateDraftInput,
} from "./schemas";
export {
  createDraftSchema,
  creditNoteSchema,
  declarationPeriodSchema,
  issueSchema,
  lineInputSchema,
  updateDraftSchema,
} from "./schemas";
