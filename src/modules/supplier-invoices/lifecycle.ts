// Delete (while nothing but its document and its subscription refer to it, D36, F94), cancel (a typed flag with a reason, only while open)
// and uncancel (D28).
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import * as linking from "@/modules/linking";
import { toSupplierInvoiceDto } from "./dto";
import { invalid, notFound, violation } from "./errors";
import type { SupplierInvoiceDto } from "./types";
import { isOpen } from "./validation";

/** The links that go with a deleted invoice: its `created_from` (D36) and its `occurrence_of` (F94, an attribution). */
const DELETE_WITH_ENTITY: ReadonlySet<string> = new Set(["created_from", "occurrence_of"]);

/**
 * Delete only while nothing refers to it; otherwise cancel (D28). Its `created_from` and `occurrence_of` links alone
 * do not block (D36, F94): they go through linking and the document returns to the inbox as *ready*, its key kept.
 * A payment or any other link still refuses.
 */
export async function deleteSupplierInvoice(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: true }>> {
  const row = await tx.supplierInvoice.findUnique({ where: { id } });
  if (!row) return { error: notFound("Supplier invoice", id) };
  const links = await linking.linksTouching(tx, "supplier_invoice", [id]);
  if (links.some((l) => !DELETE_WITH_ENTITY.has(l.kind))) {
    return {
      error: violation(`${row.key} is linked (a payment or another link) — cancel it instead`),
    };
  }
  for (const l of links) {
    const removed = await linking.removeLink(tx, caller, audit, l.id);
    if (removed.error) throw new RollbackError(removed.error);
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
