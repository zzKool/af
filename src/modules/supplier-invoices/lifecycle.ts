// Delete (only while nothing refers to it), cancel (a typed flag with a reason, only while open) and uncancel (D28).
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { toSupplierInvoiceDto } from "./dto";
import { invalid, notFound, violation } from "./errors";
import type { SupplierInvoiceDto } from "./types";
import { isOpen } from "./validation";

/** Delete only while nothing refers to it (no link, no document); otherwise cancel (D28). */
export async function deleteSupplierInvoice(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: true }>> {
  const row = await tx.supplierInvoice.findUnique({ where: { id } });
  if (!row) return { error: notFound("Supplier invoice", id) };
  const linked = await tx.link.count({
    where: {
      OR: [
        { fromType: "supplier_invoice", fromId: id },
        { toType: "supplier_invoice", toId: id },
      ],
    },
  });
  if (linked > 0 || row.paidAmount) {
    return {
      error: violation(`${row.key} is linked (a payment or its document) — cancel it instead`),
    };
  }
  await tx.supplierInvoice.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "supplier_invoice",
    entityId: id,
    oldData: toAuditData(row),
  });
  return { data: { deleted: true } };
}

export async function cancelSupplierInvoice(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  reason: string,
): Promise<ServiceResult<SupplierInvoiceDto>> {
  const trimmed = reason.trim();
  if (!trimmed) return { error: invalid("A reason is required") };
  const row = await tx.supplierInvoice.findUnique({ where: { id }, include: { lines: true } });
  if (!row) return { error: notFound("Supplier invoice", id) };
  if (row.cancelled) return { error: violation(`${row.key} is already cancelled`) };
  if (!(await isOpen(tx, id))) {
    return { error: violation(`${row.key} has a payment — remove it before cancelling`) };
  }
  const updated = await tx.supplierInvoice.update({
    where: { id },
    data: { cancelled: true, cancelledReason: trimmed, cancelledAt: new Date() },
    include: { lines: true },
  });
  await audit.log({
    action: "update",
    entityType: "supplier_invoice",
    entityId: id,
    oldData: { cancelled: false },
    newData: { cancelled: true, cancelledReason: trimmed },
  });
  return { data: toSupplierInvoiceDto(updated) };
}

export async function uncancelSupplierInvoice(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<SupplierInvoiceDto>> {
  const row = await tx.supplierInvoice.findUnique({ where: { id }, include: { lines: true } });
  if (!row) return { error: notFound("Supplier invoice", id) };
  if (!row.cancelled) return { error: violation(`${row.key} is not cancelled`) };
  const updated = await tx.supplierInvoice.update({
    where: { id },
    data: { cancelled: false, cancelledReason: null, cancelledAt: null },
    include: { lines: true },
  });
  await audit.log({
    action: "update",
    entityType: "supplier_invoice",
    entityId: id,
    oldData: { cancelled: true, cancelledReason: row.cancelledReason },
    newData: { cancelled: false },
  });
  return { data: toSupplierInvoiceDto(updated) };
}
