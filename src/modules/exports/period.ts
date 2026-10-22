// The Swiss declaration period, server side: one rule, the invoices module's (D12, D23; lesson 21). An invoice
// stores its period with `declarationPeriodFor`; the return's period list and validation use the same functions,
// so the two can never disagree on which quarter a date belongs to or what a period looks like.
import * as invoices from "@/modules/invoices";

/** The CH quarter of an ISO date: `2026-05-12` → `CH 2026/Q2`. */
export function periodOfDate(date: string): string {
  return invoices.declarationPeriodFor("CH", date);
}

/** A CH declaration period: `CH 2026/Q2`. */
export function isSwissVatPeriod(value: string): boolean {
  return invoices.isDeclarationPeriod(value) && value.startsWith("CH ");
}
