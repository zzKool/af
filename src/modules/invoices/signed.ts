// A document's amounts with the sign of what it does to income: an invoice adds, a credit note takes back.
// The one rule the dashboard pulse, the accountant package and the Swiss VAT return apply (lessons audit 27).
// Pure — no I/O. Quotes are not income; callers leave them (and drafts) out before summing.
import { Prisma } from "@/generated/prisma/browser";
import type { InvoiceType } from "./types";

type Dec = InstanceType<typeof Prisma.Decimal>;

/** `-1` for a credit note, `1` for anything else. */
export function creditSign(type: InvoiceType): 1 | -1 {
  return type === "credit_note" ? -1 : 1;
}

/** `amount` (total, base, net or VAT of the document) signed by its type: a credit note's is negative. */
export function signedTotal(type: InvoiceType, amount: Dec | string | number): Dec {
  return new Prisma.Decimal(amount).mul(creditSign(type));
}
