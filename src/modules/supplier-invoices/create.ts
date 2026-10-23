// Create (FR-001, US1): validate everything, then the key (the counter shared with the group's expenses, D28), the
// row and its lines, and — from a document — its new key and the `created_from` link, all in one transaction.
import { Prisma } from "@/generated/prisma/browser";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY, type CURRENCIES } from "@/kernel/nav/constants";
import * as documents from "@/modules/documents";
import { getGroup, noteWithAck } from "@/modules/expenses";
import * as linking from "@/modules/linking";
import {
  expenseSeries,
  nextInSeries,
  supplierInvoiceDocumentKey,
  supplierInvoiceRef,
} from "@/modules/numbering";
import { toSupplierInvoiceDto } from "./dto";
import { invalid, violation } from "./errors";
import { baseFor } from "./rate-base";
import { type SupplierInvoiceInput, supplierInvoiceInputSchema } from "./schemas";
import { addDays, DEFAULT_PAYMENT_TERMS_DAYS } from "./status";
import type { SupplierInvoiceDto } from "./types";
import {
  checkAmounts,
  checkDuplicateNumber,
  checkLineCategories,
  checkLines,
  checkVatRegistration,
  resolveAlias,
  resolveSupplier,
} from "./validation";

const D = Prisma.Decimal;

export async function createSupplierInvoice(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: SupplierInvoiceInput,
): Promise<ServiceResult<SupplierInvoiceDto>> {
  const parsed = supplierInvoiceInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;

  // 1. everything that can fail, before any write
  const found = await getGroup(tx, v.groupId);
  if (found.error) return { error: found.error };
  const group = found.data;
  const supplier = await resolveSupplier(tx, v.partnerId);
  if (supplier.error) return { error: supplier.error };
  const alias = await resolveAlias(tx, v.basCode);
  if (alias.error) return { error: alias.error };
  const vat = v.vatAmount ?? "0";
  const amountsError = checkAmounts(v.amountNet, vat, v.amountTotal);
  if (amountsError) return { error: amountsError };
  const linesError =
    checkLines(v.lines, v.amountNet, vat) ?? (await checkLineCategories(tx, v.lines));
  if (linesError) return { error: linesError };
  const vatError = await checkVatRegistration(tx, caller, v.vatRegistrationId);
  if (vatError) return { error: vatError };
  const duplicate = await checkDuplicateNumber(tx, v.partnerId, v.invoiceNumber);
  if (duplicate) return { error: duplicate };
  const currency =
    v.currency ??
    (supplier.data.defaultCurrency as (typeof CURRENCIES)[number] | null) ??
    BASE_CURRENCY;
  const terms = supplier.data.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
  const dueDate = v.dueDate ?? addDays(v.invoiceDate, terms);
  const base = await baseFor(tx, v.invoiceDate, new D(v.amountTotal), currency, v.rate);
  if (base.error) return { error: base.error };
  if (v.documentId) {
    const doc = await documents.getDocument(tx, v.documentId);
    if (doc.error) return { error: doc.error };
    if (doc.data.status === "generated")
      return { error: violation("A generated document cannot become a supplier invoice") };
    const taken = (await linking.createdFromTargets(tx, [v.documentId])).get(v.documentId);
    if (taken)
      return {
        error: violation(
          `Document ${doc.data.businessKey} already became ${taken.type} ${taken.id}`,
        ),
      };
  }

  // 2. the key — after validation, in this transaction (shared counter with the group's expenses, D28)
  const seq = await nextInSeries(tx, caller, expenseSeries(group.number, alias.data));
  const key = supplierInvoiceRef(group.number, alias.data, seq);

  // 3. the row and its lines
  const row = await tx.supplierInvoice.create({
    data: {
      tenantId: caller.tenantId,
      groupId: group.id,
      key,
      seq,
      alias: alias.data,
      partnerId: v.partnerId,
      invoiceNumber: v.invoiceNumber,
      invoiceDate: new Date(v.invoiceDate),
      dueDate: new Date(dueDate),
      dueDateDefaulted: !v.dueDate,
      currency,
      amountNet: new D(v.amountNet),
      vatAmount: new D(vat),
      amountTotal: new D(v.amountTotal),
      amountBase: base.data.amountBase,
      rate: base.data.rate,
      rateSource: base.data.rateSource,
      rateDate: base.data.rateDate ? new Date(base.data.rateDate) : null,
      basCode: v.basCode,
      vatRegistrationId: v.vatRegistrationId ?? null,
      documentMissing: v.documentMissing ?? false,
      note: noteWithAck(v.note, v.duplicateAck),
      createdBy: caller.userId,
      source: caller.source,
      lines: v.lines?.length
        ? {
            create: v.lines.map((l) => ({
              tenantId: caller.tenantId,
              lineNo: l.lineNo,
              description: l.description,
              amountNet: new D(l.amountNet),
              vatRate: new D(l.vatRate),
              vatAmount: new D(l.vatAmount),
              basCode: l.basCode,
              createdBy: caller.userId,
              source: caller.source,
            })),
          }
        : undefined,
    },
    include: { lines: true },
  });
  await audit.log({
    action: "create",
    entityType: "supplier_invoice",
    entityId: row.id,
    newData: {
      ...toAuditData(row),
      lines: row.lines.length,
      ...(v.duplicateAck ? { duplicateAck: v.duplicateAck } : {}),
    },
  });

  // 4. the document becomes this invoice (D27, D28): its key carries the vendor's name
  if (v.documentId) {
    const renamed = await documents.assignBusinessKey(
      tx,
      caller,
      audit,
      v.documentId,
      supplierInvoiceDocumentKey(key, v.invoiceDate, supplier.data.name),
    );
    if (renamed.error) throw new RollbackError(renamed.error);
    const link = await linking.createLink(tx, caller, audit, {
      from: { type: "supplier_invoice", id: row.id },
      to: { type: "document", id: v.documentId },
      kind: "created_from",
    });
    if (link.error) throw new RollbackError(link.error);
  }
  return { data: toSupplierInvoiceDto(row) };
}
