// Business keys and document numbers are FIXED FUNCTIONS (D5, D6, D21, D28) — no prefix settings, no
// pattern engine. The owner's conventions, verbatim — every client document starts with the client code
// and the year, then a type marker when it is not an invoice, then the sequence:
//   invoice      VA26-INV-001             series {partner short code}{yy}-INV, 3-digit sequence (D21, B1)
//   quote        VA26-QUO-001             series {partner short code}{yy}-QUO
//   credit note  VA26-CN-001              series {partner short code}{yy}-CN
//   invoice PDF  InvoiceAF_VA26-INV-001.pdf   the document that stores the issued invoice / quote / credit note
//   expense ref  Ex213-Tr-01              Ex{group number}-{BAS alias}-{seq within group, 2 digits}
//   expense doc  Ex213-Tr-01_2026-03-11_  the receipt's business key = {ref}_{document date}_
//   supplier inv SI213-Acc-01             SI{group number}-{BAS alias}-{seq}, same per-group counter
//   supplier doc SI213-Acc-01_2026-07-24_Skattepunkten_Office_Services_AB   {ref}_{date}_{vendor slug}
//   settlement   ST26-001                 series ST{yy} (the refund's booking date), 3-digit sequence
//   statement    Reimb_ST26-001_2026-03-31.pdf   the reimbursement statement PDF of a settlement
//   bank stmt    Bank_Plusgirokonto-SEK_2026-07-01_2026-07-31.csv   the stored CSV of a bank import: {account label slug}_{from}_{to}
//   package      Package_2026-06.zip, Package_2026-06_v2.zip, Package_2026.zip   the accountant package of a period
//   upload       exp_20261020_001         provisional key of a raw upload: {kind}{yyyymmdd}_{seq in doc-{yyyymm}}

export type UploadKind = "expense" | "invoice" | "contract" | "nda" | "certificate";

/** The v2 per-tenant prefix table, now constants (D6; the table was dropped, D30). */
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

/** `VA26` — the client code and the year, the start of every client document number (D21). */
export function clientYearSeries(partnerShortCode: string, issueDate: string): string {
  assertShortCode(partnerShortCode);
  return `${partnerShortCode}${yy(issueDate)}`;
}

/** `VA26-INV` — invoices have their own counter per client-year (D21, B1: INV / QUO / CN). */
export function invoiceSeries(partnerShortCode: string, issueDate: string): string {
  return `${clientYearSeries(partnerShortCode, issueDate)}-INV`;
}

/** `VA26-QUO` — quotes have their own counter per client-year (D21). */
export function quoteSeries(partnerShortCode: string, issueDate: string): string {
  return `${clientYearSeries(partnerShortCode, issueDate)}-QUO`;
}

/** `VA26-CN` — credit notes have their own counter per client-year; the invoice series stays gap-free (D21). */
export function creditNoteSeries(partnerShortCode: string, issueDate: string): string {
  return `${clientYearSeries(partnerShortCode, issueDate)}-CN`;
}

/** Upload counter series: one per month — `doc-2026-10`. */
export function uploadSeries(date: string): string {
  assertIsoDate(date);
  return `doc-${date.slice(0, 7)}`;
}

function assertBasAlias(basAlias: string): void {
  if (!/^[A-Za-z]{1,6}$/.test(basAlias))
    throw new Error(`BAS alias must be letters, got "${basAlias}"`);
}

/** Expense groups: one tenant-wide counter — `213 — Travel to CH in March 2026`; the number is never reused. */
export const EXPENSE_GROUP_SERIES = "expense_group";

/**
 * Expense / supplier-invoice sequence series: one per (group, BAS alias) — `exg-213-Tr` — so the two `Tr`
 * receipts of group 213 are `Ex213-Tr-01` and `-02` while its first meal is `Ex213-Rep-01` (D28: an `SI` in the
 * same group with the same alias shares the counter).
 */
export function expenseSeries(groupNumber: number, basAlias: string): string {
  assertSeq(groupNumber);
  assertBasAlias(basAlias);
  return `exg-${groupNumber}-${basAlias}`;
}

/** Reimbursement statements: one yearly series — `ST26` (the refund's booking date picks the year). */
export function settlementSeries(bookingDate: string): string {
  return `ST${yy(bookingDate)}`;
}

// --- formatted numbers and keys ---

/** `VA26-INV-001`: a series key + its 3-digit sequence (grows past 999 without truncation). */
export function formatSeriesNumber(series: string, seq: number): string {
  assertSeq(seq);
  return `${series}-${pad(seq, 3)}`;
}

export function invoiceNumber(partnerShortCode: string, issueDate: string, seq: number): string {
  return formatSeriesNumber(invoiceSeries(partnerShortCode, issueDate), seq);
}

export function quoteNumber(partnerShortCode: string, issueDate: string, seq: number): string {
  return formatSeriesNumber(quoteSeries(partnerShortCode, issueDate), seq);
}

export function creditNoteNumber(partnerShortCode: string, issueDate: string, seq: number): string {
  return formatSeriesNumber(creditNoteSeries(partnerShortCode, issueDate), seq);
}

/** `ST26-001` — the settlement number: yearly series + 3-digit sequence. */
export function settlementNumber(bookingDate: string, seq: number): string {
  return formatSeriesNumber(settlementSeries(bookingDate), seq);
}

/** The reimbursement statement PDF of a settlement: `Reimb_ST26-001_2026-03-31.pdf`. */
export function statementPdfKey(number: string, bookingDate: string): string {
  if (!/^ST\d{2}-\d{3,}$/.test(number)) throw new Error(`Not a settlement number: "${number}"`);
  assertIsoDate(bookingDate);
  return `Reimb_${number}_${bookingDate}.pdf`;
}

/** The accountant package of a period (D31): `Package_2026-06.zip`, `Package_2026-06_v2.zip`, `Package_2026.zip`. */
export function packageKey(period: string, version: number): string {
  if (!/^\d{4}(-\d{2})?$/.test(period)) throw new Error(`Not a package period: "${period}"`);
  assertSeq(version);
  return `Package_${period}${version > 1 ? `_v${version}` : ""}.zip`;
}

/** The stored PDF of an issued invoice, credit note or quote: `InvoiceAF_VA26-INV-001.pdf`. */
export function invoicePdfKey(number: string): string {
  if (!/^[A-Z0-9-]+-\d{3,}$/.test(number)) throw new Error(`Not a document number: "${number}"`);
  return `InvoiceAF_${number}.pdf`;
}

function groupRef(prefix: "Ex" | "SI", groupNumber: number, basAlias: string, seq: number): string {
  assertSeq(groupNumber);
  assertSeq(seq);
  assertBasAlias(basAlias);
  return `${prefix}${groupNumber}-${basAlias}-${pad(seq, 2)}`;
}

/** `Ex213-Tr-01` — group number, BAS alias (short code), sequence within the group. */
export function expenseRef(groupNumber: number, basAlias: string, seq: number): string {
  return groupRef("Ex", groupNumber, basAlias, seq);
}

/** `SI213-Acc-01` — a supplier invoice in the same group, same counter, SI prefix (D28). */
export function supplierInvoiceRef(groupNumber: number, basAlias: string, seq: number): string {
  return groupRef("SI", groupNumber, basAlias, seq);
}

const GROUP_REF = /^(Ex|SI)\d+-[A-Za-z]{1,6}-\d{2,}$/;

/** `Ex213-Tr-01_2026-03-11_` — the receipt's business key (and stored filename stem). */
export function expenseDocumentKey(ref: string, documentDate: string): string {
  if (!GROUP_REF.test(ref) || !ref.startsWith("Ex"))
    throw new Error(`Not an expense ref: "${ref}"`);
  assertIsoDate(documentDate);
  return `${ref}_${documentDate}_`;
}

/** Accents dropped, every run of other characters one `sep`, none at either end. */
function slug(name: string, sep: "_" | "-"): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, sep)
    .split(sep)
    .filter((part) => part !== "")
    .join(sep);
}

/** File-name-safe slug of a vendor name: `Skattepunkten's Office Services AB` → `Skattepunkten_Office_Services_AB`. */
export function fileSlug(name: string): string {
  return slug(name, "_").slice(0, 40);
}

/**
 * `Bank_Plusgirokonto-SEK_2026-07-01_2026-07-31.csv` — the stored statement of a bank import (D13): the account
 * label as a hyphen slug, the period the file covers (`x` for an unknown end).
 */
export function bankStatementKey(
  accountLabel: string,
  from: string | null,
  to: string | null,
): string {
  if (from !== null) assertIsoDate(from);
  if (to !== null) assertIsoDate(to);
  return `Bank_${slug(accountLabel, "-")}_${from ?? "x"}_${to ?? "x"}.csv`;
}

/**
 * `SI213-Acc-01_2026-07-24_Skattepunkten_Office_Services_AB` — the supplier invoice's business key:
 * the vendor name is in the file name because the owner browses the documents in a file explorer (D28).
 */
export function supplierInvoiceDocumentKey(
  ref: string,
  documentDate: string,
  vendorName: string,
): string {
  if (!GROUP_REF.test(ref) || !ref.startsWith("SI"))
    throw new Error(`Not a supplier invoice ref: "${ref}"`);
  assertIsoDate(documentDate);
  const slug = fileSlug(vendorName);
  if (!slug) throw new Error("Vendor name must contain at least one letter or digit");
  return `${ref}_${documentDate}_${slug}`;
}

/** `exp_20261020_001` — provisional key of a raw upload before it becomes an expense, invoice, … */
export function uploadDocumentKey(kind: UploadKind, date: string, seq: number): string {
  assertIsoDate(date);
  assertSeq(seq);
  return `${UPLOAD_KIND_PREFIX[kind]}${date.replace(/-/g, "")}_${pad(seq, 3)}`;
}
