// Update: note, category, registration and "no document" change freely; the money facts (supplier, number, dates,
// currency, amounts, rate, lines) only while open (D37) — the base follows by `rebase`, a typed due date stays.
import { Prisma } from "@/generated/prisma/browser";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import * as settings from "@/modules/settings";
import { iso, toLineDto, toSupplierInvoiceDto } from "./dto";
import { invalid, notFound, violation } from "./errors";
import { rebase } from "./rate-base";
import { type UpdateSupplierInvoiceInput, updateSupplierInvoiceSchema } from "./schemas";
import { addDays, DEFAULT_PAYMENT_TERMS_DAYS } from "./status";
import type { SupplierInvoiceDto } from "./types";
import {
  checkAmounts,
  checkDuplicateNumber,
  checkLineCategories,
  checkLines,
  checkVatRegistration,
  isOpen,
  resolveSupplier,
} from "./validation";

const D = Prisma.Decimal;

const MONEY_FIELDS = [
  "partnerId",
  "invoiceDate",
  "dueDate",
  "currency",
  "amountNet",
  "vatAmount",
  "amountTotal",
  "rate",
  "invoiceNumber",
] as const;

export async function updateSupplierInvoice(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: UpdateSupplierInvoiceInput,
): Promise<ServiceResult<SupplierInvoiceDto>> {
  const parsed = updateSupplierInvoiceSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const row = await tx.supplierInvoice.findUnique({ where: { id }, include: { lines: true } });
  if (!row) return { error: notFound("Supplier invoice", id) };
  if (row.cancelled) return { error: violation(`${row.key} is cancelled — uncancel it first`) };
  if (v.basCode !== undefined && !(await settings.getBasCategory(tx, v.basCode))) {
    return { error: notFound("BAS category", v.basCode) };
  }
  const vatError = await checkVatRegistration(tx, caller, v.vatRegistrationId);
  if (vatError) return { error: vatError };

  const moneyChange = MONEY_FIELDS.some((f) => v[f] !== undefined) || v.lines !== undefined;
  const data: Prisma.SupplierInvoiceUpdateInput = {
    ...(v.basCode !== undefined ? { basCode: v.basCode } : {}),
    ...(v.vatRegistrationId !== undefined ? { vatRegistrationId: v.vatRegistrationId } : {}),
    ...(v.documentMissing !== undefined ? { documentMissing: v.documentMissing } : {}),
    ...(v.note !== undefined ? { note: v.note } : {}),
  };
  if (moneyChange) {
    if (!(await isOpen(tx, id))) {
      return {
        error: violation(`${row.key} has a payment — its amounts, dates and supplier are written`),
      };
    }
    const partnerId = v.partnerId ?? row.partnerId;
    let terms: number | null = null;
    if (v.partnerId !== undefined) {
      const supplier = await resolveSupplier(tx, partnerId);
      if (supplier.error) return { error: supplier.error };
      terms = supplier.data.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
    }
    const invoiceNumber = v.invoiceNumber ?? row.invoiceNumber;
    const duplicate = await checkDuplicateNumber(tx, partnerId, invoiceNumber, id);
    if (duplicate) return { error: duplicate };
    const net = v.amountNet ?? row.amountNet.toFixed(2);
    const vat = v.vatAmount ?? row.vatAmount.toFixed(2);
    const total = v.amountTotal ?? row.amountTotal.toFixed(2);
    const amountsError = checkAmounts(net, vat, total);
    if (amountsError) return { error: amountsError };
    const lines = v.lines === undefined ? row.lines.map(toLineDto) : (v.lines ?? []);
    const linesError = checkLines(lines, net, vat) ?? (await checkLineCategories(tx, lines));
    if (linesError) return { error: linesError };
    const invoiceDate = v.invoiceDate ?? (iso(row.invoiceDate) as string);
    // the due date (audit 5): a typed one wins and stays typed; a defaulted one follows the invoice date and the
    // supplier's terms; a typed one is never re-defaulted by another edit
    const redefault =
      v.dueDate === undefined &&
      row.dueDateDefaulted &&
      ((v.invoiceDate !== undefined && v.invoiceDate !== iso(row.invoiceDate)) ||
        (v.partnerId !== undefined && v.partnerId !== row.partnerId));
    if (redefault && terms === null) {
      const supplier = await resolveSupplier(tx, partnerId);
      if (supplier.error) return { error: supplier.error };
      terms = supplier.data.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
    }
    const dueDate =
      v.dueDate ??
      (redefault
        ? addDays(invoiceDate, terms ?? DEFAULT_PAYMENT_TERMS_DAYS)
        : (iso(row.dueDate) as string));
    if (dueDate < invoiceDate)
      return { error: invalid("The due date cannot be before the invoice date") };
    const currency = v.currency ?? row.currency;
    const base = await rebase(tx, row, { invoiceDate, total, currency, typedRate: v.rate });
    if (base.error) return { error: base.error };
    Object.assign(data, {
      partnerId,
      invoiceNumber,
      invoiceDate: new Date(invoiceDate),
      dueDate: new Date(dueDate),
      dueDateDefaulted: v.dueDate !== undefined ? false : row.dueDateDefaulted,
      currency,
      amountNet: new D(net),
      vatAmount: new D(vat),
      amountTotal: new D(total),
      amountBase: base.data.amountBase,
      rate: base.data.rate,
      rateSource: base.data.rateSource,
      rateDate: base.data.rateDate ? new Date(base.data.rateDate) : null,
    });
    if (v.lines !== undefined) {
      await tx.supplierInvoiceLine.deleteMany({ where: { invoiceId: id } });
      if (v.lines?.length) {
        await tx.supplierInvoiceLine.createMany({
          data: v.lines.map((l) => ({
            tenantId: caller.tenantId,
            invoiceId: id,
            lineNo: l.lineNo,
            description: l.description,
            amountNet: new D(l.amountNet),
            vatRate: new D(l.vatRate),
            vatAmount: new D(l.vatAmount),
            basCode: l.basCode,
            createdBy: caller.userId,
            source: caller.source,
          })),
        });
      }
    }
  }
  const updated = await tx.supplierInvoice.update({
    where: { id },
    data,
    include: { lines: true },
  });
  await audit.log({
    action: "update",
    entityType: "supplier_invoice",
    entityId: id,
    oldData: toAuditData(row),
    newData: toAuditData(updated),
  });
  return { data: toSupplierInvoiceDto(updated) };
}
