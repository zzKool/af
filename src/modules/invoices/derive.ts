// Derived state of a document (specs/invoices FR-001, FR-011) — pure, no I/O. Statuses are never typed:
// paid / partially paid come from the links' allocations (settlement tolerance D25), overdue from the due
// date, credited from issued credit notes, expired / converted for quotes. `today` is clock.today().
import { Prisma } from "@/generated/prisma/browser";
import { isSettled, openAmount } from "@/kernel/money/settlement";
import type { InvoiceState, InvoiceStatus, InvoiceType } from "./types";

const D = Prisma.Decimal;

export type DeriveInput = {
  type: InvoiceType;
  status: InvoiceStatus;
  totalAmount: string;
  /** invoices / credit notes: due date; quotes: valid until (ISO day) */
  dueDate: string | null;
  /** Σ allocations of links justifying this document */
  allocated: string;
  /** Σ totals of issued credit notes referencing this invoice */
  credited: string;
  /** a quote: the issued invoice converted from it, if any */
  convertedTo: string | null;
};

export function deriveState(input: DeriveInput, today: string): InvoiceState {
  const { type, status } = input;
  if (status === "draft") return "draft";

  if (type === "quote") {
    if (input.convertedTo) return "converted";
    if (status === "accepted") return "accepted";
    if (status === "declined") return "declined";
    if (input.dueDate && input.dueDate < today) return "expired";
    return status; // issued | sent
  }

  const total = new D(input.totalAmount);
  const credited = type === "invoice" ? new D(input.credited) : new D(0);
  const allocated = new D(input.allocated);
  // fully credited → credited; otherwise what is still open is the total minus credits minus payments
  if (credited.gt(0) && credited.gte(total)) return "credited";
  const open = total.sub(credited);
  if (open.gt(0) && isSettled(open, [allocated])) return "paid";
  if (allocated.gt(0)) return "partially_paid";
  // a credit note is money the company owes back, not a claim on the client: it is never overdue
  // (its stored due date is the issue date, F57 / lessons audit 3)
  if (type === "invoice" && input.dueDate && input.dueDate < today) return "overdue";
  return status === "sent" ? "sent" : "issued";
}

/** `total − credited − allocated`, floored at 0, as a 2-decimal string — the kernel's `openAmount`. */
export function remainingAmount(totalAmount: string, allocated: string, credited = "0"): string {
  return openAmount(totalAmount, allocated, credited).toFixed(2);
}

/**
 * What the client still owes on this document — the `remaining` of the read model. Only an issued
 * invoice is a receivable: a draft is not billed, a quote is never paid, a credit note is owed TO the
 * client and already reduces its original through `credited` (F57).
 */
export function receivableAmount(
  input: Pick<DeriveInput, "type" | "status" | "totalAmount" | "allocated" | "credited">,
): string {
  if (input.type !== "invoice" || input.status === "draft") return "0.00";
  return remainingAmount(input.totalAmount, input.allocated, input.credited);
}

/** `CH 2026/Q1` for an issue date, the Swiss quarterly declaration period (D12, D23). */
export function declarationPeriodFor(country: string, issueDate: string): string {
  const year = issueDate.slice(0, 4);
  const month = Number(issueDate.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${country.toUpperCase()} ${year}/Q${quarter}`;
}

const DECLARATION_PERIOD = /^[A-Z]{2} \d{4}\/Q[1-4]$/;
export function isDeclarationPeriod(value: string): boolean {
  return DECLARATION_PERIOD.test(value);
}
