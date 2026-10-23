// Payments (FR-004; US2): a `justifies` link from the paying bank row. Same currency → allocations in the invoice
// currency (instalments, batch payments); another currency → the row is attached like a company-paid expense
// (D-g = D26): what the bank paid becomes `paid_amount / paid_currency`, the row's journal base the invoice's base
// (`rate_source = bank`), one link of the paid amount. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { settlementTolerance } from "@/kernel/money/settlement";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import { positiveMoney, uuid } from "@/kernel/validation/scalars";
import * as banking from "@/modules/banking";
import * as journal from "@/modules/journal";
import * as linking from "@/modules/linking";
import * as rates from "@/modules/rates";
import { allocatedTo } from "./allocated";
import { openAmount } from "./status";
import {
  baseAmount,
  invalid,
  notFound,
  toSupplierInvoiceDto,
  violation,
} from "./supplier-invoices";
import type { SupplierInvoiceDto } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export const recordPaymentSchema = z.object({
  invoiceId: uuid,
  bankTransactionId: uuid,
  /** in the invoice currency; omitted = min(|row|, open) */
  amount: positiveMoney.optional(),
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const attachPaymentSchema = z.object({ invoiceId: uuid, bankTransactionId: uuid });

async function outgoingRow(tx: TransactionClient, id: string) {
  const t = await banking.getBankTransaction(tx, id);
  if (!t) return { error: notFound("Bank transaction", id) };
  if (new D(t.amount).gte(0)) {
    return {
      error: violation(
        `${t.bookingDate} ${t.amount} ${t.currency} is incoming — a supplier is paid by an outgoing row`,
      ),
    };
  }
  return { data: t };
}

/** Same currency: an allocation in the invoice currency, never beyond what is open (US2-1…3). */
export async function recordPayment(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: RecordPaymentInput,
): Promise<ServiceResult<SupplierInvoiceDto & { linkId: string; allocated: string }>> {
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const row = await tx.supplierInvoice.findUnique({
    where: { id: parsed.data.invoiceId },
    include: { lines: true },
  });
  if (!row) return { error: notFound("Supplier invoice", parsed.data.invoiceId) };
  if (row.cancelled) return { error: violation(`${row.key} is cancelled`) };
  if (row.paidAmount)
    return { error: violation(`${row.key} was paid by an attached bank row — detach it first`) };
  const t = await outgoingRow(tx, parsed.data.bankTransactionId);
  if (t.error) return { error: t.error };
  if (t.data.currency !== row.currency) {
    return {
      error: violation(
        `The row is in ${t.data.currency}, the invoice in ${row.currency} — attach the row as the payment instead (the bank's rate applies)`,
        { rowCurrency: t.data.currency, invoiceCurrency: row.currency },
      ),
    };
  }
  const open = openAmount(row.amountTotal, await allocatedTo(tx, row.id));
  if (open.lte(settlementTolerance(row.amountTotal)))
    return { error: violation(`${row.key} has nothing open`) };
  const rowAmount = new D(t.data.amount).abs();
  const amount = parsed.data.amount ? new D(parsed.data.amount) : D.min(rowAmount, open);
  if (amount.gt(open)) {
    return {
      error: violation(
        `${amount.toFixed(2)} ${row.currency} exceeds the open ${open.toFixed(2)} ${row.currency} on ${row.key}`,
      ),
    };
  }
  // the rounding note when this allocation closes the invoice within the tolerance
  const remaining = open.minus(amount);
  const note =
    remaining.gt(0) && remaining.lte(settlementTolerance(row.amountTotal))
      ? `Rounding adjustment: ${row.currency} ${remaining.toFixed(2)} (settlement tolerance)`
      : null;
  const link = await linking.createLink(
    tx,
    caller,
    audit,
    {
      from: { type: "bank_transaction", id: t.data.id },
      to: { type: "supplier_invoice", id: row.id },
      kind: "justifies",
      allocatedAmount: amount.toFixed(2),
      currency: row.currency,
      note,
    },
    { owner: "supplier_invoice" },
  );
  if (link.error) return { error: link.error };
  await audit.log({
    action: "update",
    entityType: "supplier_invoice",
    entityId: row.id,
    newData: {
      payment: {
        bankTransactionId: t.data.id,
        amount: amount.toFixed(2),
        currency: row.currency,
        note,
      },
    },
  });
  return {
    data: { ...toSupplierInvoiceDto(row), linkId: link.data.id, allocated: amount.toFixed(2) },
  };
}

/** Remove one payment link (the invoice reopens by that amount). */
export async function removePayment(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { invoiceId: string; linkId: string },
): Promise<ServiceResult<SupplierInvoiceDto>> {
  const row = await tx.supplierInvoice.findUnique({
    where: { id: input.invoiceId },
    include: { lines: true },
  });
  if (!row) return { error: notFound("Supplier invoice", input.invoiceId) };
  const link = (
    await linking.linksTouching(tx, "supplier_invoice", [row.id], { kinds: ["justifies"] })
  ).find((l) => l.id === input.linkId && l.to.type === "supplier_invoice" && l.to.id === row.id);
  if (!link) return { error: notFound("Payment link", input.linkId) };
  if (row.paidAmount)
    return { error: violation(`${row.key} was paid by an attached bank row — detach it instead`) };
  const removed = await linking.removeLink(tx, caller, audit, link.id, {
    owner: "supplier_invoice",
  });
  if (removed.error) return { error: removed.error };
  return { data: toSupplierInvoiceDto(row) };
}

/**
 * Another currency (US2-4, D-g): the bank row's amount is what the company paid; its journal base becomes the
 * invoice's base (`rate_source = bank`); one `justifies` link allocates the paid amount in the paid currency.
 */
export async function attachPayment(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { invoiceId: string; bankTransactionId: string },
): Promise<ServiceResult<SupplierInvoiceDto>> {
  const parsed = attachPaymentSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const row = await tx.supplierInvoice.findUnique({
    where: { id: parsed.data.invoiceId },
    include: { lines: true },
  });
  if (!row) return { error: notFound("Supplier invoice", parsed.data.invoiceId) };
  if (row.cancelled) return { error: violation(`${row.key} is cancelled`) };
  if (row.paidAmount)
    return { error: violation(`${row.key} already has its bank row — detach it first`) };
  if ((await allocatedTo(tx, row.id)).gt(0)) {
    return {
      error: violation(
        `${row.key} already has payments in ${row.currency} — remove them before attaching a row in another currency`,
      ),
    };
  }
  const t = await outgoingRow(tx, parsed.data.bankTransactionId);
  if (t.error) return { error: t.error };
  if (t.data.currency === row.currency) {
    return {
      error: violation(`The row is in the invoice currency — record it as a payment instead`),
    };
  }
  const entries = await journal.entriesForSources(tx, "bank_transaction", [t.data.id]);
  const entry = entries.get(t.data.id);
  if (!entry) return { error: violation(`Bank transaction ${t.data.id} has no journal entry`) };
  const paid = new D(t.data.amount).abs();
  const updated = await tx.supplierInvoice.update({
    where: { id: row.id },
    data: {
      paidAmount: paid,
      paidCurrency: t.data.currency,
      amountBase: new D(entry.amountBase).abs(),
      rate: new D(entry.rate),
      rateSource: "bank",
      rateDate: entry.rateDate ? new Date(entry.rateDate) : null,
    },
    include: { lines: true },
  });
  await audit.log({
    action: "update",
    entityType: "supplier_invoice",
    entityId: row.id,
    oldData: {
      amountBase: row.amountBase.toFixed(2),
      rateSource: row.rateSource,
      paidAmount: null,
    },
    newData: {
      bankTransactionId: t.data.id,
      paidAmount: paid.toFixed(2),
      paidCurrency: t.data.currency,
      amountBase: updated.amountBase.toFixed(2),
      rateSource: "bank",
    },
  });
  const link = await linking.createLink(
    tx,
    caller,
    audit,
    {
      from: { type: "bank_transaction", id: t.data.id },
      to: { type: "supplier_invoice", id: row.id },
      kind: "justifies",
      allocatedAmount: paid.toFixed(2),
      currency: t.data.currency,
    },
    { owner: "supplier_invoice" },
  );
  if (link.error) throw new RollbackError(link.error);
  return { data: toSupplierInvoiceDto(updated) };
}

/** The reverse of attach: the links from bank rows go, the base returns to the ECB of the invoice date. */
export async function detachPayment(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  invoiceId: string,
): Promise<ServiceResult<SupplierInvoiceDto>> {
  const row = await tx.supplierInvoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true },
  });
  if (!row) return { error: notFound("Supplier invoice", invoiceId) };
  if (!row.paidAmount) return { error: violation(`${row.key} has no attached bank row`) };
  const links = (
    await linking.linksTouching(tx, "supplier_invoice", [invoiceId], { kinds: ["justifies"] })
  ).filter(
    (l) =>
      l.from.type === "bank_transaction" &&
      l.to.type === "supplier_invoice" &&
      l.to.id === invoiceId,
  );
  for (const l of links) {
    const removed = await linking.removeLink(tx, caller, audit, l.id, {
      owner: "supplier_invoice",
    });
    if (removed.error) return { error: removed.error };
  }
  const date = row.invoiceDate.toISOString().slice(0, 10);
  const r = await rates.rateToBase(tx, date, row.currency, BASE_CURRENCY);
  if (!r) throw new RollbackError(violation(`No exchange rate for ${date} — run the ECB sync`));
  const updated = await tx.supplierInvoice.update({
    where: { id: invoiceId },
    data: {
      paidAmount: null,
      paidCurrency: null,
      amountBase: baseAmount(row.amountTotal, r.rate),
      rate: r.rate,
      rateSource: r.source,
      rateDate: r.source === "same_currency" ? null : new Date(r.rateDate),
    },
    include: { lines: true },
  });
  await audit.log({
    action: "update",
    entityType: "supplier_invoice",
    entityId: invoiceId,
    oldData: { paidAmount: row.paidAmount.toFixed(2), paidCurrency: row.paidCurrency },
    newData: {
      paidAmount: null,
      amountBase: updated.amountBase.toFixed(2),
      rateSource: updated.rateSource,
    },
  });
  return { data: toSupplierInvoiceDto(updated) };
}
