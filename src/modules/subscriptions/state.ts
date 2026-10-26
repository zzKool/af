// The one rule for a period's state (F94 US2-2 … US2-5) — pure. Read from facts only: the period, the entities
// attributed to it, the offers found, today. Paid / overdue are the owning module's words, never re-derived here.
import { daysUntil } from "@/kernel/clock/calendar";
import type { Becomes, EntityFact, Period, PeriodMark, PeriodState } from "./types";

export type StateInput = {
  period: Period;
  becomes: Becomes;
  /** the subscription's payer is a private source: no bank row to wait for */
  privatePaid: boolean;
  /** attributed to this period, oldest first */
  entities: readonly EntityFact[];
  /** a bank row / a receipt is offered and not confirmed yet */
  rowOffered: boolean;
  documentOffered: boolean;
  today: string;
};

/** Before this many days ahead of its expected date a period is upcoming (the row window opens). */
const UPCOMING_BEFORE = 3;

export function periodState(i: StateInput): { state: PeriodState; marks: PeriodMark[] } {
  const marks: PeriodMark[] = [];
  const { period, today } = i;
  if (i.entities.length > 1) marks.push("two_charges");
  const rowClosed = today > period.rowWindow.to;
  const receiptClosed = today > period.receiptWindow.to;
  const entity = i.entities[0];

  if (period.skipped && !entity) return { state: "skipped", marks };

  if (entity) {
    const payOk = !entity.needsPayment || entity.paid;
    const docOk = entity.hasDocument;
    if (docOk && payOk) return { state: "done", marks };
    if (payOk) {
      // paid, no document: the receipt is what is left
      if (i.documentOffered) marks.push("match_waiting");
      else if (receiptClosed) marks.push("receipt_missing");
      return { state: "charged", marks };
    }
    if (docOk) {
      if (entity.type === "supplier_invoice") {
        // its payment is the supplier invoice's own flow (US3-6): overdue is its word, not a to-do here
        if (entity.overdue) marks.push("overdue");
      } else if (i.rowOffered) marks.push("match_waiting");
      else if (rowClosed) marks.push("charge_missing");
      return { state: "documented", marks };
    }
    // recorded, but neither paid nor documented yet
    if (i.rowOffered || i.documentOffered) marks.push("match_waiting");
    else if (entity.type === "expense" && rowClosed) marks.push("charge_missing");
    return { state: "due", marks };
  }

  const offered = i.becomes === "expense" ? i.rowOffered || i.documentOffered : i.documentOffered;
  // an early receipt / bill (its window opens ten days ahead) makes an upcoming period due: there is something to confirm
  if (daysUntil(today, period.date) > UPCOMING_BEFORE && !offered)
    return { state: "upcoming", marks };
  if (offered) marks.push("match_waiting");
  else if (i.becomes === "supplier_invoice") {
    if (receiptClosed) marks.push("bill_missing");
  } else if (i.privatePaid) {
    if (receiptClosed) marks.push("receipt_missing");
  } else if (rowClosed) marks.push("charge_missing");
  return { state: "due", marks };
}
