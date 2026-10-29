// The compare card's rules (F97, specs/justify/spec.md US1): pure, client-safe — the panel computes the card in the
// browser from the row and the OCR reading; the service re-reads nothing of it. No module imports.
import { Prisma } from "@/generated/prisma/browser";
import { daysBetween } from "@/kernel/clock/calendar";
import type { OcrExtractedData } from "@/kernel/ocr/ocr";

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

const isoDay = (s: string | undefined): string | null =>
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

/** The row against the reading — the card's facts. Pure. */
export function compareRowToReading(row: RowForJustify, reading: Reading): CompareCard {
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

// --- the no-proof reasons (US3): data, the BAS each one proposes ---

export type NoProofReason = "fee" | "tax" | "salary" | "interest" | "other";
export const NO_PROOF_REASONS: readonly NoProofReason[] = [
  "fee",
  "tax",
  "salary",
  "interest",
  "other",
];
/** the account each reason proposes (the owner's active set may not hold it — then none is written) */
export const NO_PROOF_BAS: Record<NoProofReason, string | null> = {
  fee: "657",
  tax: "251",
  salary: "721",
  interest: "831",
  other: null,
};
