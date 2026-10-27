// The payment window (F116 FR-001, specs/linking/one-engine.md): when can a bank row pay an entity? Not "within
// ±5 days of its issue date" — an invoice on 30-day terms is paid a month later. Pure; the finder, the inbox and
// the scorer's date claim read the same rule.
//
//   entity with terms (an invoice, a supplier invoice)   [issue − 5, max(due + 10, issue + 60)]
//   entity dated once (an expense, a receipt)            [date − 10, date + 10]
import { addDays } from "@/kernel/clock/calendar";
import type { LinkableType } from "./types";

/** Days a row may precede the issue date (a card charged the day before the SaaS invoice is dated). */
export const BEFORE_ISSUE_DAYS = 5;
/** Days a row may follow the due date (a late payment is still a payment). */
export const AFTER_DUE_DAYS = 10;
/** The window never closes sooner than this after the issue date — short or missing terms. */
export const MIN_TERMS_DAYS = 60;
/** ± days around an entity dated once. */
export const DATED_WINDOW_DAYS = 10;

/** The types whose window comes from their terms. */
export const HAS_TERMS: ReadonlySet<LinkableType> = new Set(["invoice", "supplier_invoice"]);

export type Windowed = { type: LinkableType; date: string; dueDate?: string | null };

/** The ISO days, inclusive, a row may be booked on to pay `e`. */
export function paymentWindow(e: Windowed): { from: string; to: string } {
  if (HAS_TERMS.has(e.type)) {
    const due = e.dueDate ? addDays(e.dueDate, AFTER_DUE_DAYS) : e.date;
    const floor = addDays(e.date, MIN_TERMS_DAYS);
    return { from: addDays(e.date, -BEFORE_ISSUE_DAYS), to: due > floor ? due : floor };
  }
  return { from: addDays(e.date, -DATED_WINDOW_DAYS), to: addDays(e.date, DATED_WINDOW_DAYS) };
}

export function inWindow(rowDate: string, e: Windowed): boolean {
  const w = paymentWindow(e);
  return rowDate >= w.from && rowDate <= w.to;
}

/**
 * For a linkable with terms (F116 FR-001): the entities a row booked in [bookedFrom, bookedTo] can still pay are
 * issued on or before `issuedTo` and either due on or after `dueFrom` or issued on or after `issuedFrom` — the
 * mirror of `paymentWindow`. Null when the query carries no booking span (then the dated span applies).
 */
export function termsSpan(q: {
  bookedFrom?: string;
  bookedTo?: string;
}): { issuedTo: string; dueFrom: string; issuedFrom: string } | null {
  if (!q.bookedFrom || !q.bookedTo) return null;
  return {
    issuedTo: addDays(q.bookedTo, BEFORE_ISSUE_DAYS),
    dueFrom: addDays(q.bookedFrom, -AFTER_DUE_DAYS),
    issuedFrom: addDays(q.bookedFrom, -MIN_TERMS_DAYS),
  };
}

/** The extra lookups beyond the window — by number, by remembered partner — read this many each. */
export const EXTRA_CANDIDATES = 20;
