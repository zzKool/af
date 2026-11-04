// The consistency checks of a proof (F130, review 2026-10-31 §4): the bank row against the reading of the paper
// dropped on it, and against what the partner, the counterparty memory and the rules say. Pure and client-safe —
// the reading dialog (F131) runs them in the browser on facts the caller supplies; nothing here reads a table.
// Seven checks, at most one warning each; every warning is a claim with its numbers (never "looks wrong") and
// never a block: *Confirm* stays available, and the codes the owner confirmed over go on the `justifies` link's
// audit trail (`justifyRow`, `confirmedWarnings`). The sentences are `linking.checks.*` (`warningMessage`).
//
//   vendor_counterparty  green: the paper's VAT number is the partner's · the key was linked to the partner before
//                        (`memoryForRow`) · a rule for the key names the partner (D74) · a name token hits the row
//                        text (`nameInTexts` — `MSFT` never finds Microsoft, by design)
//   amount_fx            another currency: the paper at the ECB rate of the booking date, in the row's currency,
//                        within `fxTolerance(card | other)` of what the bank took; no rate stored → said, not compared
//   amount_same          the same currency: equal within the settlement tolerance (D25), both ways
//   date                 a card row 0–5 days after the paper; any other row inside the payment window (`window.ts`)
//   billed_to            D53's verdict, computed by the caller (documents owns the rule)
//   already_proof        the document justifies another row · the supplier's number exists (D35) — the caller's facts
//   currency_unread      the paper has an amount but no currency (F61-b): the amount is not compared
import { Prisma } from "@/generated/prisma/browser";
import { daysUntil } from "@/kernel/clock/calendar";
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";
import { formatMoney } from "@/kernel/money/format-money";
import { type FxToleranceKind, fxTolerance } from "@/kernel/money/fx-tolerance";
import { settlementTolerance } from "@/kernel/money/settlement";
import {
  compareRowToReading,
  isCardPurchase,
  isoDay,
  type Reading,
  type RowForJustify,
} from "./justify-rules";
import { nameInTexts } from "./scoring";
import type { DateAnchor, ProofPartner, ProofWarning } from "./types";
import { paymentWindow } from "./window";

const D = Prisma.Decimal;

/** Days a card row may be booked after the paper's date — the scheme settles within the week. */
export const CARD_SETTLE_DAYS = 5;

/** What the checks compare. The caller (the dialog, F131) gathers the facts; the function only compares. */
export type CheckProofInput = {
  /** the banking DTO's facts, as the compare card reads them */
  row: Pick<
    RowForJustify,
    "bookingDate" | "amount" | "currency" | "amountBase" | "description" | "counterpartyKey"
  >;
  /** the row's other text fields the bank gave (name, message, details, sender, recipient) — searched for the name too */
  rowTexts?: readonly (string | null | undefined)[];
  /** the OCR reading as corrected; empty when nothing was read */
  reading: Reading;
  /** the partner matched or picked in the dialog; null before any pick */
  partner: ProofPartner | null;
  /** `memoryForRow(row)`: the partners this counterparty key was linked to before (D67) */
  memory: readonly { partnerId: string }[];
  /** the partners named by the active rules whose text matches the key (D74 — the caller reads the rules) */
  rulePartnerIds: readonly string[];
  /**
   * the ECB rate of the booking date from the reading's currency into the row's (`rates.rateToBase(tx,
   * bookingDate, reading.currency, row.currency).rate`, the lookup `withForeignBases` makes); null when none is
   * stored for that day; ignored when the currencies agree
   */
  fxRate: string | null;
  /** D53: the paper's *billed to* names the company (documents' `billed-to.ts`); null = nothing read to judge */
  billedToFits: boolean | null;
  companyName: string;
  /** the row this document already justifies, if any */
  documentJustifiesOther: { rowDate: string } | null;
  /** the reading's invoice number already exists for the supplier (D35) — derived from `reading.invoiceNumber` */
  supplierNumberTaken: boolean;
};

/** A VAT number as compared: letters and digits only, upper case (`SE 5566-77889901` = `SE556677889901`). */
const foldVat = (s: string | null | undefined): string =>
  (s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** 100 × a share as a signed one-decimal string: `0.0351` → `"3.5"`, `-0.021` → `"-2.1"`. */
const pct = (share: InstanceType<typeof D>): string =>
  share.mul(100).toDecimalPlaces(1, D.ROUND_HALF_UP).toFixed(1);

/** `"0.04"` → `"4"`: the tolerance as the sentence says it. */
const tolerancePct = (share: string): string => new D(share).mul(100).toString();

function vendorCounterparty(
  input: CheckProofInput,
  vendorName: string | null,
): ProofWarning | null {
  const { row, partner } = input;
  // nothing on the paper's side to compare: the partner pick is the dialog's, not a warning's
  if (!vendorName && !partner) return null;
  const texts = [row.description, row.counterpartyKey, ...(input.rowTexts ?? [])];
  if (partner) {
    const vat = foldVat(input.reading.vendorTaxId);
    if (vat && vat === foldVat(partner.vatNumber)) return null;
    if (input.memory.some((m) => m.partnerId === partner.id)) return null;
    if (input.rulePartnerIds.includes(partner.id)) return null;
    if (nameInTexts(partner.name, texts)) return null;
  }
  if (nameInTexts(vendorName, texts)) return null;
  return {
    code: "vendor_counterparty",
    facts: {
      vendorName: (vendorName ?? partner?.name) as string,
      counterpartyKey: row.counterpartyKey || row.description,
    },
  };
}

/**
 * The paper's amount at the ECB rate of the booking date against what the bank took, in the row's currency:
 * green within `fxTolerance` of the kind (judged on the exact share, not the printed percentage); a missing rate is
 * said, not compared.
 */
function amountAcrossCurrencies(
  input: CheckProofInput,
  readingAmount: string,
  readingCurrency: string,
  rowAmount: string,
): ProofWarning | null {
  const { row } = input;
  const kind: FxToleranceKind = isCardPurchase(row) ? "card" : "other";
  const tolerance = fxTolerance(kind);
  const base = {
    readingAmount,
    readingCurrency,
    rowAmount,
    rowCurrency: row.currency,
    bookingDate: row.bookingDate,
    tolerancePct: tolerancePct(tolerance),
    kind,
  };
  const rate = input.fxRate ? new D(input.fxRate) : null;
  if (!rate || rate.lte(0)) {
    return { code: "amount_fx", facts: { ...base, rate: null, converted: null, offPct: null } };
  }
  const converted = new D(readingAmount).mul(rate).toDecimalPlaces(2, D.ROUND_HALF_UP);
  if (converted.lte(0)) return null;
  const off = new D(rowAmount).minus(converted).div(converted);
  if (off.abs().lte(tolerance)) return null;
  return {
    code: "amount_fx",
    facts: { ...base, rate: rate.toString(), converted: converted.toFixed(2), offPct: pct(off) },
  };
}

function amountSameCurrency(
  readingAmount: string,
  rowAmount: string,
  currency: string,
): ProofWarning | null {
  const difference = new D(rowAmount).minus(readingAmount);
  if (difference.abs().lte(settlementTolerance(readingAmount))) return null;
  return {
    code: "amount_same",
    facts: { readingAmount, rowAmount, currency, difference: difference.toFixed(2) },
  };
}

function date(input: CheckProofInput, paperDate: string | null): ProofWarning | null {
  if (!paperDate) return null;
  const { row } = input;
  const booking = row.bookingDate;
  const warn = (
    days: number,
    when: "before" | "after",
    anchor: DateAnchor,
    anchorDate: string,
  ): ProofWarning => ({
    code: "date",
    facts: { days, when, anchor, anchorDate, bookingDate: booking },
  });
  if (isCardPurchase(row)) {
    const days = daysUntil(paperDate, booking);
    if (days < 0) return warn(-days, "before", "paper", paperDate);
    if (days > CARD_SETTLE_DAYS) return warn(days, "after", "paper", paperDate);
    return null;
  }
  const dueDate = isoDay(input.reading.dueDate);
  const window = paymentWindow({ type: "supplier_invoice", date: paperDate, dueDate });
  if (booking < window.from)
    return warn(daysUntil(booking, paperDate), "before", "invoice", paperDate);
  if (booking > window.to) {
    const anchorDate = dueDate ?? paperDate;
    return warn(daysUntil(anchorDate, booking), "after", dueDate ? "due" : "invoice", anchorDate);
  }
  return null;
}

/** The seven checks on one proof; an empty list is all green. Order: the review's table. */
export function checkProof(input: CheckProofInput): ProofWarning[] {
  const { row, reading } = input;
  const card = compareRowToReading(row, reading);
  const out: ProofWarning[] = [];

  const vendor = vendorCounterparty(input, card.vendorName);
  if (vendor) out.push(vendor);

  const readingAmount = card.documentAmount;
  const readingCurrency = card.documentCurrency;
  if (readingAmount && readingCurrency) {
    const amount =
      readingCurrency !== row.currency
        ? amountAcrossCurrencies(input, readingAmount, readingCurrency, card.rowAmount)
        : amountSameCurrency(readingAmount, card.rowAmount, row.currency);
    if (amount) out.push(amount);
  }

  const when = date(input, card.documentDate);
  if (when) out.push(when);

  if (input.billedToFits === false) {
    out.push({
      code: "billed_to",
      facts: { companyName: input.companyName, billedTo: reading.customerName ?? null },
    });
  }

  if (input.documentJustifiesOther || input.supplierNumberTaken) {
    out.push({
      code: "already_proof",
      facts: {
        rowDate: input.documentJustifiesOther?.rowDate ?? null,
        invoiceNumber: input.supplierNumberTaken ? (card.invoiceNumber ?? null) : null,
      },
    });
  }

  if (readingAmount && !readingCurrency) {
    out.push({
      code: "currency_unread",
      facts: { readingAmount, rowAmount: card.rowAmount, rowCurrency: row.currency },
    });
  }

  return out;
}

// --- the sentences ---

type Translate = (key: MessageKey, params?: MessageParams) => string;

/** An amount in the D40 format (`1 297.20 SEK`); the raw pair when the string is not a decimal (an OCR read gone wrong). */
function money(amount: string, currency: string, signed = false): string {
  try {
    return formatMoney(amount, currency, { signed });
  } catch {
    return `${amount} ${currency}`;
  }
}

/** `"3.5"` → `"+3.5"`, `"-2.1"` → `"−2.1"` (the kit's minus), `"0.0"` → `"0.0"`. */
function signedPct(p: string): string {
  if (p.startsWith("-")) return `−${p.slice(1)}`;
  return /^0(\.0+)?$/.test(p) ? p : `+${p}`;
}

/** One warning as one line in the reader's language — the facts put into the key's sentence. */
export function warningMessage(warning: ProofWarning, t: Translate): string {
  switch (warning.code) {
    case "vendor_counterparty":
      return t("linking.checks.vendor_counterparty", warning.facts);
    case "amount_fx": {
      const f = warning.facts;
      const paper = money(f.readingAmount, f.readingCurrency);
      const bank = money(f.rowAmount, f.rowCurrency);
      if (f.rate === null || f.converted === null || f.offPct === null)
        return t("linking.checks.amount_fx.noRate", { paper, bank, date: f.bookingDate });
      return t("linking.checks.amount_fx", {
        paper,
        rate: f.rate,
        converted: money(f.converted, f.rowCurrency),
        bank,
        offPct: signedPct(f.offPct),
        tolerancePct: f.tolerancePct,
        kind: t(`linking.checks.kind.${f.kind}`),
      });
    }
    case "amount_same": {
      const f = warning.facts;
      return t("linking.checks.amount_same", {
        difference: money(f.difference, f.currency, true),
        paper: money(f.readingAmount, f.currency),
        bank: money(f.rowAmount, f.currency),
      });
    }
    case "date": {
      const f = warning.facts;
      return t(`linking.checks.date.${f.when}`, {
        days: f.days,
        anchor: t(`linking.checks.date.anchor.${f.anchor}`),
        date: f.anchorDate,
      });
    }
    case "billed_to": {
      const f = warning.facts;
      return f.billedTo
        ? t("linking.checks.billed_to", { billedTo: f.billedTo, companyName: f.companyName })
        : t("linking.checks.billed_to.unnamed", { companyName: f.companyName });
    }
    case "already_proof": {
      const f = warning.facts;
      if (f.rowDate && f.invoiceNumber)
        return t("linking.checks.already_proof.both", {
          rowDate: f.rowDate,
          invoiceNumber: f.invoiceNumber,
        });
      if (f.rowDate) return t("linking.checks.already_proof.document", { rowDate: f.rowDate });
      return t("linking.checks.already_proof.number", { invoiceNumber: f.invoiceNumber ?? "" });
    }
    case "currency_unread": {
      const f = warning.facts;
      return t("linking.checks.currency_unread", {
        readingAmount: f.readingAmount,
        bank: money(f.rowAmount, f.rowCurrency),
      });
    }
  }
}
