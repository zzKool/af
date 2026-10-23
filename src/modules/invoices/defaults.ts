// What a draft starts from and how its lines become rows: the defaults chain, the line rows with their
// totals, and an existing document's lines back as input (update, copy, convert).
import type { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { InvoiceLine } from "@/generated/prisma/client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import * as settings from "@/modules/settings";
import { iso, toDate } from "./dto";
import { invalid } from "./errors";
import type { lineInputSchema } from "./schemas";
import { invoiceTotals, type LineInput, TotalsError } from "./totals";
import type { Registration } from "./vat-treatment";

const D = Prisma.Decimal;

// --- defaults chain (partner → contract → registration) ---

/** `NET_30` → issue + 30 days; `PREPAID` / `ON_RECEIPT` → the issue date; unknown → 30 days. */
export function dueDateFor(issueDate: string, paymentTerms: string | null | undefined): string {
  const m = /^NET_(\d+)$/.exec(paymentTerms ?? "");
  const days = m
    ? Number(m[1])
    : paymentTerms === "PREPAID" || paymentTerms === "ON_RECEIPT"
      ? 0
      : 30;
  return addDays(issueDate, days);
}

export async function registrationById(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string | null | undefined,
): Promise<Registration | null> {
  if (!id) return null;
  const regs = await settings.getVatRegistrations(tx, caller);
  return regs.data?.find((r) => r.id === id) ?? null;
}

export function lineRowsFrom(
  tenantId: string,
  lines: z.output<typeof lineInputSchema>[],
): Prisma.InvoiceLineCreateManyInvoiceInput[] | AppError {
  let totals: ReturnType<typeof invoiceTotals>;
  const inputs: LineInput[] = lines.map((l) => ({
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    vatRate: l.vatRate,
    discountPercent: l.discountPercent ?? null,
    discountFixed: l.discountFixed ?? null,
  }));
  try {
    totals = invoiceTotals(inputs);
  } catch (e) {
    if (e instanceof TotalsError)
      return invalid(e.lineIndex != null ? `Line ${e.lineIndex + 1}: ${e.message}` : e.message);
    throw e;
  }
  return lines.map((l, i) => ({
    tenantId,
    lineNo: i + 1,
    description: l.description,
    quantity: new D(l.quantity),
    unit: l.unit,
    unitPrice: new D(l.unitPrice),
    discountPercent: l.discountPercent ? new D(l.discountPercent) : null,
    discountAmount: new D(totals.lines[i].discountAmount),
    netAmount: new D(totals.lines[i].net),
    vatRate: new D(l.vatRate),
    vatAmount: new D(totals.lines[i].vatAmount),
    periodStart: l.periodStart ? toDate(l.periodStart) : null,
    periodEnd: l.periodEnd ? toDate(l.periodEnd) : null,
    rateSourceId: l.rateSourceId ?? null,
  }));
}

export function totalsData(
  lines: z.output<typeof lineInputSchema>[],
  discountPercent: string | null,
) {
  const t = invoiceTotals(
    lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      discountPercent: l.discountPercent ?? null,
      discountFixed: l.discountFixed ?? null,
    })),
    discountPercent,
  );
  return {
    subtotal: new D(t.subtotal),
    discountAmount: new D(t.discountAmount),
    netAmount: new D(t.net),
    vatAmount: new D(t.vat),
    totalAmount: new D(t.total),
    vatByRate: t.vatByRate as unknown as Prisma.InputJsonValue,
  };
}

export function linesToInput(lines: InvoiceLine[]): z.output<typeof lineInputSchema>[] {
  return [...lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => ({
      description: l.description,
      quantity: l.quantity.toString(),
      unit: l.unit,
      unitPrice: l.unitPrice.toFixed(2),
      discountPercent: l.discountPercent ? l.discountPercent.toString() : null,
      discountFixed: l.discountPercent
        ? null
        : l.discountAmount.gt(0)
          ? l.discountAmount.toFixed(2)
          : null,
      vatRate: l.vatRate.toString(),
      periodStart: iso(l.periodStart),
      periodEnd: iso(l.periodEnd),
      rateSourceId: l.rateSourceId,
    }));
}
