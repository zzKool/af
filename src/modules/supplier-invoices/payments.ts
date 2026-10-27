// Payments (FR-004; US2, F114 / D60): a `justifies` link from the paying bank row is the whole record — the amount
// it pays in the invoice's currency (instalments, batch payments, a deposit and a balance) and the base the row
// gave. Another currency changes nothing on the invoice: the link carries the row's base, the FX difference is
// derived. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { openAmount, settlementTolerance } from "@/kernel/money/settlement";
import { positiveMoney, uuid } from "@/kernel/validation/scalars";
import * as banking from "@/modules/banking";
import * as linking from "@/modules/linking";
import { allocatedTo } from "./allocated";
import { invalid, notFound, toSupplierInvoiceDto, violation } from "./supplier-invoices";
import type { SupplierInvoiceDto } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export const recordPaymentSchema = z.object({
  invoiceId: uuid,
  bankTransactionId: uuid,
  /** in the invoice currency; omitted = what is open (same currency: no more than the row has left) */
  amount: positiveMoney.optional(),
  /** the base the row gives; omitted = pro rata of the row's base (same currency) or the row's remaining base */
  amountBase: positiveMoney.optional(),
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

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

/** One payment: an allocation in the invoice currency, never beyond what is open (US2-1…4), any row currency. */
export async function recordPayment(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: RecordPaymentInput,
): Promise<
  ServiceResult<SupplierInvoiceDto & { linkId: string; allocated: string; allocatedBase: string }>
> {
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const row = await tx.supplierInvoice.findUnique({
    where: { id: parsed.data.invoiceId },
    include: { lines: true },
  });
  if (!row) return { error: notFound("Supplier invoice", parsed.data.invoiceId) };
  if (row.cancelled) return { error: violation(`${row.key} is cancelled`) };
  const t = await outgoingRow(tx, parsed.data.bankTransactionId);
  if (t.error) return { error: t.error };
  const open = openAmount(row.amountTotal, await allocatedTo(tx, row.id));
  if (open.lte(settlementTolerance(row.amountTotal)))
    return { error: violation(`${row.key} has nothing open`) };
  let amount = parsed.data.amount ? new D(parsed.data.amount) : open;
  if (!parsed.data.amount && t.data.currency === row.currency) {
    // same currency: what the row has left, in its own currency
    const rowStatus = await linking.getAllocationStatus(tx, {
      type: "bank_transaction",
      id: t.data.id,
    });
    if (rowStatus.error) return { error: rowStatus.error };
    const rowLeft = new D(rowStatus.data?.remaining ?? new D(t.data.amount).abs().toFixed(2));
    if (rowLeft.lte(0)) {
      return {
        error: violation(
          `${t.data.bookingDate} ${t.data.amount} ${t.data.currency} has nothing left to allocate`,
        ),
      };
    }
    amount = D.min(rowLeft, open);
  }
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
      allocatedBase: parsed.data.amountBase ?? null,
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
        linkId: link.data.id,
        bankTransactionId: t.data.id,
        amount: amount.toFixed(2),
        currency: row.currency,
        allocatedBase: link.data.allocatedBase,
        note,
      },
    },
  });
  return {
    data: {
      ...toSupplierInvoiceDto(row),
      linkId: link.data.id,
      allocated: amount.toFixed(2),
      allocatedBase: link.data.allocatedBase ?? "0.00",
    },
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
  const removed = await linking.removeLink(tx, caller, audit, link.id, {
    owner: "supplier_invoice",
  });
  if (removed.error) return { error: removed.error };
  await audit.log({
    action: "update",
    entityType: "supplier_invoice",
    entityId: row.id,
    oldData: {
      payment: {
        linkId: link.id,
        bankTransactionId: link.from.id,
        amount: link.allocatedAmount,
        currency: link.currency,
        allocatedBase: link.allocatedBase,
      },
    },
    newData: {},
  });
  return { data: toSupplierInvoiceDto(row) };
}
