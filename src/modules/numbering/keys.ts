// Business keys and document numbers are FIXED FUNCTIONS (D5, D6) — no prefix settings, no pattern
// engine. The Excel conventions, verbatim:
//   invoice      VA26-001                 series {partner short code}{yy}, 3-digit sequence
//   quote        QUO26-001                series QUO{yy}
//   credit note  CN-VA26-001              series CN-{partner short code}{yy}
//   invoice PDF  InvoiceAF_VA26-001.pdf   the document that stores the issued invoice
//   expense ref  Ex213-Tr-01              Ex{group number}-{BAS alias}-{seq within group, 2 digits}
//   expense doc  Ex213-Tr-01_2026-03-11_  the receipt's business key = {ref}_{document date}_
//   upload       exp_20261020_001         provisional key of a raw upload: {kind}{yyyymmdd}_{seq in doc-{yyyymm}}

export type UploadKind = "expense" | "invoice" | "contract" | "nda" | "certificate";

/** Replaces the v2 document_type_prefixes table — the same strings, now constants. */
export const UPLOAD_KIND_PREFIX: Record<UploadKind, string> = {
  expense: "exp_",
  invoice: "inv_",
  contract: "ctrt_",
  nda: "nda_",
  certificate: "cert_",
};

export const UPLOAD_KINDS = Object.keys(UPLOAD_KIND_PREFIX) as UploadKind[];

export function isUploadKind(value: string): value is UploadKind {
  return value in UPLOAD_KIND_PREFIX;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(date: string): void {
  if (!ISO_DATE.test(date)) throw new Error(`Expected an ISO date (yyyy-mm-dd), got "${date}"`);
}

function assertSeq(seq: number): void {
  if (!Number.isInteger(seq) || seq < 1)
    throw new Error(`Sequence must be a positive integer, got ${seq}`);
}

function assertShortCode(code: string): void {
  if (!/^[A-Z0-9]{2,6}$/.test(code)) {
    throw new Error(`Partner short code must be 2–6 upper-case letters or digits, got "${code}"`);
  }
}

/** `yy` of an ISO date: 2026-10-20 → "26". */
export function yy(date: string): string {
  assertIsoDate(date);
  return date.slice(2, 4);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// --- series keys (what number_series is keyed by) ---

export function invoiceSeries(partnerShortCode: string, issueDate: string): string {
  assertShortCode(partnerShortCode);
  return `${partnerShortCode}${yy(issueDate)}`;
}

export function quoteSeries(issueDate: string): string {
  return `QUO${yy(issueDate)}`;
}

export function creditNoteSeries(partnerShortCode: string, issueDate: string): string {
  assertShortCode(partnerShortCode);
  return `CN-${partnerShortCode}${yy(issueDate)}`;
}

/** Upload counter series: one per month — `doc-2026-10`. */
export function uploadSeries(date: string): string {
  assertIsoDate(date);
  return `doc-${date.slice(0, 7)}`;
}

/** Expense sequence series: one per expense group — `exg-213`. */
export function expenseGroupSeries(groupNumber: number): string {
  assertSeq(groupNumber);
  return `exg-${groupNumber}`;
}

// --- formatted numbers and keys ---

/** `VA26-001`: a series key + its 3-digit sequence (grows past 999 without truncation). */
export function formatSeriesNumber(series: string, seq: number): string {
  assertSeq(seq);
  return `${series}-${pad(seq, 3)}`;
}

export function invoiceNumber(partnerShortCode: string, issueDate: string, seq: number): string {
  return formatSeriesNumber(invoiceSeries(partnerShortCode, issueDate), seq);
}

export function quoteNumber(issueDate: string, seq: number): string {
  return formatSeriesNumber(quoteSeries(issueDate), seq);
}

export function creditNoteNumber(partnerShortCode: string, issueDate: string, seq: number): string {
  return formatSeriesNumber(creditNoteSeries(partnerShortCode, issueDate), seq);
}

/** The stored PDF of an issued invoice, credit note or quote: `InvoiceAF_VA26-001.pdf`. */
export function invoicePdfKey(number: string): string {
  if (!/^[A-Z0-9-]+-\d{3,}$/.test(number)) throw new Error(`Not a document number: "${number}"`);
  return `InvoiceAF_${number}.pdf`;
}

/** `Ex213-Tr-01` — group number, BAS alias (short code), sequence within the group. */
export function expenseRef(groupNumber: number, basAlias: string, seq: number): string {
  assertSeq(groupNumber);
  assertSeq(seq);
  if (!/^[A-Za-z]{1,6}$/.test(basAlias))
    throw new Error(`BAS alias must be letters, got "${basAlias}"`);
  return `Ex${groupNumber}-${basAlias}-${pad(seq, 2)}`;
}

/** `Ex213-Tr-01_2026-03-11_` — the receipt's business key (and stored filename stem). */
export function expenseDocumentKey(ref: string, documentDate: string): string {
  if (!/^Ex\d+-[A-Za-z]{1,6}-\d{2,}$/.test(ref)) throw new Error(`Not an expense ref: "${ref}"`);
  assertIsoDate(documentDate);
  return `${ref}_${documentDate}_`;
}

/** `exp_20261020_001` — provisional key of a raw upload before it becomes an expense, invoice, … */
export function uploadDocumentKey(kind: UploadKind, date: string, seq: number): string {
  assertIsoDate(date);
  assertSeq(seq);
  return `${UPLOAD_KIND_PREFIX[kind]}${date.replace(/-/g, "")}_${pad(seq, 3)}`;
}
