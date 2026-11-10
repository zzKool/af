// The compare card's rules (F97, specs/justify/spec.md US1): pure, client-safe — the panel computes the card in the
// browser from the row and the OCR reading; the service re-reads nothing of it. No module imports beyond a type
// (the partner roles, from partners' client surface).
import { Prisma } from "@/generated/prisma/browser";
import { daysBetween } from "@/kernel/clock/calendar";
import type { OcrExtractedData, OcrPaper } from "@/kernel/ocr/ocr";
import type { SystemRole } from "@/modules/partners/ui";

const D = Prisma.Decimal;

export type JustifyKind = "supplier_invoice" | "expense";

/** What the card reads of the row — the banking DTO's facts, nothing more. */
export type RowForJustify = {
  id: string;
  bookingDate: string;
  /** signed */
  amount: string;
  currency: string;
  /** signed */
  amountBase: string;
  description: string;
  counterpartyKey: string;
  bankAccountId: string;
  /** the row's account — the payer of an expense made from it (F114) */
  accountLabel: string;
};

/** The OCR reading as corrected (`DocumentReviewData.resolvedData`); empty when the OCR failed or nothing was uploaded. */
export type Reading = Partial<OcrExtractedData>;

export type CompareCard = {
  kind: JustifyKind;
  /** the document's total as read, 2 dp, or null */
  documentAmount: string | null;
  documentCurrency: string | null;
  /** |row amount| */
  rowAmount: string;
  rowCurrency: string;
  /** document − |row| in the row's currency when the currencies agree; null otherwise */
  delta: string | null;
  /** the amounts agree to the cent (same currency) */
  equal: boolean;
  /** the reading is in another currency than the row (a card purchase abroad, D26) */
  currencyDiffers: boolean;
  documentDate: string | null;
  /** |booking − document| in days, null without a document date */
  days: number | null;
  vendorName: string | null;
  vatNumber: string | null;
  invoiceNumber: string | null;
};

/** The ISO day of a date the OCR read (`2026-07-06` or `2026-07-06T00:00:00Z`); null for anything else. */
export const isoDay = (s: string | undefined): string | null =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
const moneyOf = (n: number | undefined): string | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? new D(n).toFixed(2) : null;

/** A card purchase (`Kortköp …`, the counterparty key already stripped of the prefix) is a receipt, not an invoice. */
export function isCardPurchase(row: Pick<RowForJustify, "description">): boolean {
  return /^\s*KORT\s?K[ÖO]P\b/i.test(row.description);
}

/**
 * The kind the facts propose (spec US1 scenario 5): a card purchase is an expense whatever the document says —
 * a cloud bill paid by card is printed like an invoice (number, VAT number) and is still a receipt in the books;
 * otherwise an invoice number or a VAT number read → a supplier invoice; nothing read → an expense (a receipt).
 * The owner flips it on the card.
 */
export function proposeKind(
  row: Pick<RowForJustify, "description">,
  reading: Reading,
): JustifyKind {
  if (isCardPurchase(row)) return "expense";
  if (reading.invoiceNumber || reading.vendorTaxId) return "supplier_invoice";
  return reading.merchantName && !reading.vendorName ? "expense" : "supplier_invoice";
}

/** The row against the reading — the card's facts. Pure. Reads the row's money, date and description only. */
export function compareRowToReading(
  row: Pick<RowForJustify, "bookingDate" | "amount" | "currency" | "description">,
  reading: Reading,
): CompareCard {
  const rowAmount = new D(row.amount).abs().toFixed(2);
  const documentAmount = moneyOf(reading.invoiceTotal);
  const documentCurrency = reading.currency ? reading.currency.toUpperCase() : null;
  const currencyDiffers = !!documentCurrency && documentCurrency !== row.currency;
  const delta =
    documentAmount && !currencyDiffers ? new D(documentAmount).minus(rowAmount).toFixed(2) : null;
  const documentDate = isoDay(reading.invoiceDate) ?? isoDay(reading.transactionDate);
  return {
    kind: proposeKind(row, reading),
    documentAmount,
    documentCurrency,
    rowAmount,
    rowCurrency: row.currency,
    delta,
    equal: delta === "0.00",
    currencyDiffers,
    documentDate,
    days: documentDate ? daysBetween(documentDate, row.bookingDate) : null,
    vendorName: reading.vendorName ?? reading.merchantName ?? null,
    vatNumber: reading.vendorTaxId ?? null,
    invoiceNumber: reading.invoiceNumber ?? null,
  };
}

/** `2026-07` of a booking date — the group a row's month proposes. */
export function monthOf(bookingDate: string): string {
  return bookingDate.slice(0, 7);
}

// --- the paper question (D75, review 2026-10-31 §2 row 2.3; F131) ---

/**
 * What the paper is — asked on every drop, *Invoice* by default (O5); it picks the reading model, never the kind.
 * The kernel's `OcrPaper`: the drop zone sends the answer itself beside the upload's type (`paper` on
 * `uploadDocumentAction` / `classifyDocumentAction`), so `ocrModelFor` reads a PDF called *Receipt* with the receipt
 * model — D69's file rule gives way to the owner's answer on the row only.
 */
export type Paper = OcrPaper;
export const PAPERS: readonly Paper[] = ["invoice", "receipt"];
export const DEFAULT_PAPER: Paper = "invoice";

/** The upload type the paper sends beside the answer: *Invoice* → `invoice`, *Receipt* → `expense` (the kind `/documents` shows). */
export function prefixTypeOfPaper(paper: Paper): "invoice" | "expense" {
  return paper === "invoice" ? "invoice" : "expense";
}

/** The paper a stored document's type says — the dialog's radio for a document that was uploaded before (*Use it*). */
export function paperOfPrefixType(prefixType: string | null | undefined): Paper {
  return prefixType === "expense" ? "receipt" : "invoice";
}

/** The paper each reading model reads (D75 — the receipt model a till receipt, the invoice model the rest). */
const PAPER_OF_MODEL: Readonly<Record<string, Paper>> = {
  "prebuilt-invoice": "invoice",
  "prebuilt-receipt": "receipt",
};

/**
 * The paper a document already read says (T030, *Use it*): the model that read it — an `expense` PDF read by the
 * invoice model (D69) shows *Invoice*, what the fields on screen are — else, unread or by another model, its type.
 */
export function paperOfReading(
  modelUsed: string | null | undefined,
  prefixType: string | null | undefined,
): Paper {
  return (modelUsed ? PAPER_OF_MODEL[modelUsed] : undefined) ?? paperOfPrefixType(prefixType);
}

// --- the green checks (review §6.3: *✓ amount equal · ✓ 2 days · ✓ vendor = counterparty*) ---

export type GreenCheck =
  /** the same currency, equal to the cent */
  | { code: "amount"; kind: "equal" }
  /** the same currency, inside the settlement tolerance — the difference is named (every claim is true) */
  | { code: "amount"; kind: "within"; difference: string; currency: string }
  /** another currency, inside the FX tolerance at the ECB rate */
  | { code: "amount"; kind: "fx"; currency: string }
  | { code: "days"; days: number }
  | { code: "vendor" };

/**
 * The checks worth a ✓ line once `checkProof` found nothing to say about them: the amount (read, same currency and
 * equal — or another currency within the tolerance), the days between the paper and the booking (a date read), the
 * vendor against the counterparty (a vendor read or a partner picked). Pure; the warnings are `checkProof`'s codes.
 */
export function greenChecks(
  row: Pick<RowForJustify, "bookingDate" | "amount" | "currency" | "description">,
  reading: Reading,
  partnerPicked: boolean,
  warningCodes: readonly string[],
): GreenCheck[] {
  const card = compareRowToReading(row, reading);
  const warned = new Set(warningCodes);
  const out: GreenCheck[] = [];
  if (
    card.documentAmount &&
    card.documentCurrency &&
    !warned.has("amount_same") &&
    !warned.has("amount_fx") &&
    !warned.has("currency_unread")
  ) {
    if (card.currencyDiffers)
      out.push({ code: "amount", kind: "fx", currency: card.documentCurrency });
    else if (card.equal) out.push({ code: "amount", kind: "equal" });
    else
      out.push({
        code: "amount",
        kind: "within",
        difference: card.delta ?? "0.00",
        currency: row.currency,
      });
  }
  if (card.days !== null && !warned.has("date")) out.push({ code: "days", days: card.days });
  if ((card.vendorName || partnerPicked) && !warned.has("vendor_counterparty"))
    out.push({ code: "vendor" });
  return out;
}

// --- the no-proof reasons (US3; F129 US3: each names a partner too) — data, the BAS and the partner each proposes ---

export type NoProofReason = "fee" | "tax" | "salary" | "interest" | "client" | "other";
export const NO_PROOF_REASONS: readonly NoProofReason[] = [
  "fee",
  "tax",
  "salary",
  "interest",
  "client",
  "other",
];
/** the reasons as an incoming row offers them (a tax repayment, a client's refund, interest): *client paid* first */
export const NO_PROOF_REASONS_INCOMING: readonly NoProofReason[] = [
  "client",
  "tax",
  "interest",
  "salary",
  "fee",
  "other",
];
/**
 * The account each reason proposes — the owner's accounts (D84, F187): Skatteverket's tax account 1630, his salary
 * 7220; a tax row on a CHF account is Swiss VAT, 2890 (`noProofBas`). Editable on the row.
 */
export const NO_PROOF_BAS: Record<NoProofReason, string | null> = {
  fee: "6570",
  tax: "1630",
  salary: "7220",
  interest: "8310",
  client: null,
  other: null,
};
const TAX_BAS_BY_CURRENCY: Record<string, string> = { CHF: "2890" };

/** The reason's account for a row of an account in this currency: tax goes by the country, like its partner. Pure. */
export function noProofBas(reason: NoProofReason, accountCurrency: string): string | null {
  if (reason === "tax")
    return TAX_BAS_BY_CURRENCY[accountCurrency.toUpperCase()] ?? NO_PROOF_BAS.tax;
  return NO_PROOF_BAS[reason];
}

/** The partner a reason proposes, by type: a system partner's role, the client (the picker), or none (F129 FR-007). */
export type ProposedPartner = SystemRole | "client" | null;
const PARTNER_BY_REASON: Record<Exclude<NoProofReason, "tax">, ProposedPartner> = {
  fee: "bank",
  interest: "bank",
  salary: "owner",
  client: "client",
  other: null,
};
const TAX_AGENCY_BY_CURRENCY: Record<string, SystemRole> = { CHF: "tax_agency_ch" };

/**
 * Which partner a *no proof* reason proposes (D73 (b)): fee / interest → the bank, tax → the Swiss FTA on a CHF
 * account else Skatteverket (the owner's Q4: a fact, switchable), salary → the owner as employee, client paid → the
 * client picker (the memory's partner when it has one), other → none. Pure.
 */
export function proposedPartnerRole(
  reason: NoProofReason,
  accountCurrency: string,
): ProposedPartner {
  if (reason === "tax")
    return TAX_AGENCY_BY_CURRENCY[accountCurrency.toUpperCase()] ?? "tax_agency_se";
  return PARTNER_BY_REASON[reason];
}

// --- D74: a confirmed vendor ↔ counterparty becomes a rule (F129 FR-008) ---

/** The rule the panel proposes after a proof is linked: the counterparty key → the proof's partner (+ the category). */
export type VendorRuleDraft = {
  name: string;
  matchType: "contains";
  matchField: "counterparty_key";
  matchPattern: string;
  partnerId: string;
  basCode: string | null;
};

/** `proposeVendorRule(key, partnerId, basCode)`: F97's `createRuleFromTransaction` shape, pure — the next import carries the partner before any proof. */
export function proposeVendorRule(
  key: string,
  partnerId: string,
  basCode: string | null,
): VendorRuleDraft {
  return {
    name: key,
    matchType: "contains",
    matchField: "counterparty_key",
    matchPattern: key,
    partnerId,
    basCode,
  };
}
