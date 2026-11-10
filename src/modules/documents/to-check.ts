// What a field *to check* asks (F185, the board *Documents*: "“07-08” — August 7 or July 8?"): a field the reading
// is not sure of opens in place with one question and its one-click answers, derived from the reading alone —
//   · a date printed with numbers only whose day and month could swap (`07-08`) → the two dates;
//   · a total that is not net + VAT → the total as read, or net + VAT;
//   · anything else → *is it right?* (the owner confirms the value, or edits it in place).
// An answer is a correction on the document (`updateDocumentCorrections`), so the field becomes sure — the owner's
// word. Pure, client-safe.
import type { CorrectionsPatch } from "./ocr-payload";
import type { InboxFacts } from "./queries";
import { isSure, type MarkedKey, type ReadMark } from "./reading-marks";

export type CheckAsk =
  /** `options[0]` = the date as read, `[1]` = day and month swapped; `printed` = the text on the page */
  | { kind: "dateOrder"; printed: string; options: [string, string] }
  /** `options[0]` = the total as read, `[1]` = net + VAT (2 dp) */
  | { kind: "total"; options: [string, string] }
  | { kind: "confirm" };

export const DATE_KEYS: readonly MarkedKey[] = ["invoiceDate", "transactionDate", "dueDate"];
export const AMOUNT_KEYS: readonly MarkedKey[] = ["invoiceTotal", "subtotal", "totalTax"];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-08-07` → `2026-07-08` when both could be a month and they differ; null when the date is not ambiguous. */
export function swappedDate(value: string): string | null {
  const m = ISO.exec(value);
  if (!m) return null;
  const [, y, mm, dd] = m;
  if (Number(dd) > 12 || Number(mm) > 12 || mm === dd) return null;
  return `${y}-${dd}-${mm}`;
}

/** A date printed with numbers only, the year not first (`07-08`, `07/08/2026`, `8.7.26`) — the order is a guess. */
export function printedAmbiguously(printed: string): boolean {
  const p = printed.trim();
  if (!p || /[a-z]/i.test(p)) return false;
  if (/^\d{4}[-./]/.test(p)) return false;
  return /^\d{1,2}[-./ ]\d{1,2}([-./ ]\d{2,4})?$/.test(p);
}

/** The question a field to check asks; null when the field is sure (DI's high band, or the owner's word). */
export function checkAsk(
  mark: ReadMark,
  facts: InboxFacts,
  corrected: readonly string[] = [],
): CheckAsk | null {
  if (isSure(mark, corrected)) return null;
  const value = facts[mark.key as keyof InboxFacts];
  if (DATE_KEYS.includes(mark.key) && typeof value === "string") {
    const swapped = swappedDate(value);
    const printed = mark.content ?? value;
    if (swapped && printedAmbiguously(printed))
      return { kind: "dateOrder", printed, options: [value, swapped] };
  }
  if (mark.key === "invoiceTotal") {
    const total = Number(facts.invoiceTotal);
    const net = Number(facts.subtotal);
    const vat = Number(facts.totalTax);
    if (
      facts.subtotal !== undefined &&
      facts.totalTax !== undefined &&
      Number.isFinite(total) &&
      Number.isFinite(net) &&
      Number.isFinite(vat) &&
      Math.abs(net + vat - total) > 0.005
    )
      return { kind: "total", options: [total.toFixed(2), (net + vat).toFixed(2)] };
  }
  return { kind: "confirm" };
}

/** A typed answer → the correction it writes: amounts as numbers, dates and text as strings; null when empty. */
export function correctionFor(key: MarkedKey, answer: string): CorrectionsPatch | null {
  const v = answer.trim();
  if (!v) return null;
  if (AMOUNT_KEYS.includes(key)) {
    const n = Number(v.replace(/[\s\u202f]/g, "").replace(",", "."));
    return Number.isFinite(n) ? ({ [key]: n } as CorrectionsPatch) : null;
  }
  if (DATE_KEYS.includes(key)) return ISO.test(v) ? ({ [key]: v } as CorrectionsPatch) : null;
  return { [key]: v } as CorrectionsPatch;
}
