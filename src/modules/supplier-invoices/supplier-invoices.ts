// Supplier invoices (FR-001, FR-004; US1): a payable keyed like an expense in the same group, the supplier's number
// (unique per supplier), a due date defaulted from the partner's terms, VAT under a registration, optional split
// lines, the SEK base of the invoice date written once. Money facts change only while unpaid and unlinked; the key
// never. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { SupplierInvoice, SupplierInvoiceLine } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { type AppError, RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY, CURRENCIES } from "@/kernel/nav/constants";
import * as documents from "@/modules/documents";
import * as linking from "@/modules/linking";
import {
  expenseSeries,
  nextInSeries,
  supplierInvoiceDocumentKey,
  supplierInvoiceRef,
} from "@/modules/numbering";
import * as partners from "@/modules/partners";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import { addDays, DEFAULT_PAYMENT_TERMS_DAYS } from "./status";
import type {
  SupplierInvoiceDto,
  SupplierInvoiceLineDto,
  SupplierInvoiceRateSource,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export const violation = (
  message: string,
  details?: Record<string, string | number>,
): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});
export const invalid = (message: string): AppError => ({
  code: "VALIDATION_ERROR",
  message,
  retryable: false,
});
export const notFound = (what: string, id: string): AppError => ({
  code: "NOT_FOUND",
  message: `${what} not found: ${id}`,
  retryable: false,
});

// --- Zod schemas (the boundary) ---

const isoDate = z.string().date();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Use digits with up to 2 decimals");
const positiveMoney = money.refine((v) => Number(v) > 0, "The amount must be positive");
const positiveRate = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Use digits with up to 6 decimals")
  .refine((v) => Number(v) > 0, "The rate must be positive");
const uuid = z.string().uuid();
const basCode = z.string().regex(/^\d{3,4}$/, "A BAS code is 3 or 4 digits");

export const lineSchema = z.object({
  lineNo: z.number().int().min(1),
  description: z.string().trim().min(1, "Line description is required").max(200),
  amountNet: money,
  vatRate: z.string().regex(/^\d+(\.\d{1,2})?$/, "A VAT rate is a percentage"),
  vatAmount: money,
  basCode,
});
export type LineInput = z.input<typeof lineSchema>;

export const supplierInvoiceInputSchema = z
  .object({
    groupId: uuid,
    partnerId: uuid,
    invoiceNumber: z.string().trim().min(1, "The supplier's invoice number is required").max(100),
    invoiceDate: isoDate,
    /** omitted → invoice date + the partner's terms (30 when unset), flagged `dueDateDefaulted` */
    dueDate: isoDate.optional(),
    currency: z.enum(CURRENCIES).optional(),
    amountNet: money,
    vatAmount: money.optional(),
    amountTotal: positiveMoney,
    basCode,
    vatRegistrationId: uuid.nullable().optional(),
    /** typed by hand → rate_source = manual; omitted → ECB of the invoice date */
    rate: positiveRate.optional(),
    documentMissing: z.boolean().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    /** the reviewed document this invoice is created from (D27) */
    documentId: uuid.optional(),
    /** the VAT / category split — none by default (FR-001) */
    lines: z.array(lineSchema).max(50).optional(),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.invoiceDate, {
    message: "The due date cannot be before the invoice date",
  });
export type SupplierInvoiceInput = z.input<typeof supplierInvoiceInputSchema>;

export const updateSupplierInvoiceSchema = z
  .object({
    partnerId: uuid.optional(),
    invoiceNumber: z.string().trim().min(1).max(100).optional(),
    invoiceDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    currency: z.enum(CURRENCIES).optional(),
    amountNet: money.optional(),
    vatAmount: money.optional(),
    amountTotal: positiveMoney.optional(),
    basCode: basCode.optional(),
    vatRegistrationId: uuid.nullable().optional(),
    rate: positiveRate.optional(),
    documentMissing: z.boolean().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    lines: z.array(lineSchema).max(50).nullable().optional(),
  })
  .refine((v) => !v.dueDate || !v.invoiceDate || v.dueDate >= v.invoiceDate, {
    message: "The due date cannot be before the invoice date",
  });
export type UpdateSupplierInvoiceInput = z.input<typeof updateSupplierInvoiceSchema>;

// --- DTO mapping ---

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function toLineDto(l: SupplierInvoiceLine): SupplierInvoiceLineDto {
  return {
    id: l.id,
    lineNo: l.lineNo,
    description: l.description,
    amountNet: l.amountNet.toFixed(2),
    vatRate: l.vatRate.toFixed(2),
    vatAmount: l.vatAmount.toFixed(2),
    basCode: l.basCode,
  };
}

export function toSupplierInvoiceDto(
  row: SupplierInvoice & { lines?: SupplierInvoiceLine[] },
): SupplierInvoiceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    groupId: row.groupId,
    key: row.key,
    seq: row.seq,
    alias: row.alias,
    partnerId: row.partnerId,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: iso(row.invoiceDate) ?? "",
    dueDate: iso(row.dueDate) ?? "",
    dueDateDefaulted: row.dueDateDefaulted,
    currency: row.currency,
    amountNet: row.amountNet.toFixed(2),
    vatAmount: row.vatAmount.toFixed(2),
    amountTotal: row.amountTotal.toFixed(2),
    amountBase: row.amountBase.toFixed(2),
    rate: row.rate.toString(),
    rateSource: row.rateSource as SupplierInvoiceRateSource,
    rateDate: iso(row.rateDate),
    paidAmount: row.paidAmount ? row.paidAmount.toFixed(2) : null,
    paidCurrency: row.paidCurrency,
    basCode: row.basCode,
    vatRegistrationId: row.vatRegistrationId,
    documentMissing: row.documentMissing,
    note: row.note,
    cancelled: row.cancelled,
    cancelledReason: row.cancelledReason,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
    lines: (row.lines ?? []).map(toLineDto).sort((a, b) => a.lineNo - b.lineNo),
  };
}

// --- the SEK base ---

type Base = {
  amountBase: Dec;
  rate: Dec;
  rateSource: SupplierInvoiceRateSource;
  rateDate: string | null;
};

export function baseAmount(amount: Dec | string, rate: Dec | string): Dec {
  return new D(amount).mul(new D(rate)).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

async function baseFor(
  tx: TransactionClient,
  date: string,
  amount: Dec,
  currency: string,
  typedRate: string | undefined,
): Promise<ServiceResult<Base>> {
  if (typedRate !== undefined) {
    if (currency === BASE_CURRENCY && new D(typedRate).toNumber() !== 1) {
      return { error: invalid(`The rate of a ${BASE_CURRENCY} amount is 1`) };
    }
    const rate = new D(typedRate);
    return {
      data: {
        amountBase: baseAmount(amount, rate),
        rate,
        rateSource: currency === BASE_CURRENCY ? "same_currency" : "manual",
        rateDate: null,
      },
    };
  }
  const r = await rates.rateToBase(tx, date, currency, BASE_CURRENCY);
  if (!r) {
    return {
      error: violation(`No exchange rate for ${date} — run the ECB sync`, { date, currency }),
    };
  }
  return {
    data: {
      amountBase: baseAmount(amount, r.rate),
      rate: r.rate,
      rateSource: r.source,
      rateDate: r.source === "same_currency" ? null : r.rateDate,
    },
  };
}

// --- validation ---

const TOTAL_TOLERANCE = new D("0.01");

function checkAmounts(net: string, vat: string, total: string): AppError | null {
  const n = new D(net);
  const v = new D(vat);
  const t = new D(total);
  if (v.lt(0) || n.lt(0)) return invalid("Net and VAT cannot be negative");
  if (t.minus(n.plus(v)).abs().gt(TOTAL_TOLERANCE)) {
    return invalid(`Total ${t.toFixed(2)} must equal net ${n.toFixed(2)} + VAT ${v.toFixed(2)}`);
  }
  return null;
}

function checkLines(lines: LineInput[] | undefined, net: string, vat: string): AppError | null {
  if (!lines || lines.length === 0) return null;
  const nos = new Set<number>();
  let sumNet = new D(0);
  let sumVat = new D(0);
  for (const l of lines) {
    if (nos.has(l.lineNo)) return invalid("Line numbers must be unique");
    nos.add(l.lineNo);
    sumNet = sumNet.plus(l.amountNet);
    sumVat = sumVat.plus(l.vatAmount);
  }
  if (sumNet.minus(net).abs().gt(TOTAL_TOLERANCE))
    return invalid(
      `The lines' net ${sumNet.toFixed(2)} must equal the invoice net ${new D(net).toFixed(2)}`,
    );
  if (sumVat.minus(vat).abs().gt(TOTAL_TOLERANCE))
    return invalid(
      `The lines' VAT ${sumVat.toFixed(2)} must equal the invoice VAT ${new D(vat).toFixed(2)}`,
    );
  return null;
}

async function resolveAlias(tx: TransactionClient, code: string): Promise<ServiceResult<string>> {
  const cat = await settings.getBasCategory(tx, code);
  if (!cat) return { error: notFound("BAS category", code) };
  const alias = await settings.basAlias(tx, code);
  if (!alias) {
    return {
      error: violation(
        `Category ${code} ${cat.name} has no short code — set one under Settings → BAS categories`,
        { basCode: code },
      ),
    };
  }
  if (!/^[A-Za-z]{1,6}$/.test(alias)) {
    return {
      error: violation(
        `The short code "${alias}" of category ${code} must be 1–6 letters to be part of a key`,
      ),
    };
  }
  return { data: alias };
}

async function resolveSupplier(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<partners.PartnerDto>> {
  const p = await partners.getPartner(tx, id);
  if (!p.data) return { error: notFound("Supplier", id) };
  if (!p.data.types.includes("vendor")) {
    return { error: violation(`${p.data.name} is not a vendor — add the type on the partner`) };
  }
  return { data: p.data };
}

async function checkVatRegistration(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string | null | undefined,
): Promise<AppError | null> {
  if (!id) return null;
  const regs = await settings.getVatRegistrations(tx, caller);
  if (!(regs.data ?? []).some((r) => r.id === id)) return notFound("VAT registration", id);
  return null;
}

async function checkLineCategories(
  tx: TransactionClient,
  lines: LineInput[] | undefined,
): Promise<AppError | null> {
  for (const l of lines ?? []) {
    if (!(await settings.getBasCategory(tx, l.basCode))) return notFound("BAS category", l.basCode);
  }
  return null;
}

/** The same supplier never gets the same number twice (case- and space-insensitive). */
async function checkDuplicateNumber(
  tx: TransactionClient,
  partnerId: string,
  invoiceNumber: string,
  exceptId?: string,
): Promise<AppError | null> {
  const rows = await tx.$queryRawUnsafe<{ id: string; key: string }[]>(
    `SELECT id, key FROM supplier_invoices WHERE partner_id = $1::uuid AND lower(btrim(invoice_number)) = lower(btrim($2)) LIMIT 2`,
    partnerId,
    invoiceNumber,
  );
  const hit = rows.find((r) => r.id !== exceptId);
  if (hit)
    return violation(
      `Invoice ${invoiceNumber} of this supplier is already recorded as ${hit.key}`,
      { key: hit.key },
    );
  return null;
}

/** Links or a cross-currency payment: once either exists the money facts are written (US1-8). */
export async function isOpen(tx: TransactionClient, id: string): Promise<boolean> {
  const row = await tx.supplierInvoice.findUnique({ where: { id }, select: { paidAmount: true } });
  if (!row || row.paidAmount) return false;
  const links = await tx.link.count({
    where: { kind: "justifies", toType: "supplier_invoice", toId: id },
  });
  return links === 0;
}

// --- writes ---

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
  const group = await tx.expenseGroup.findUnique({ where: { id: v.groupId } });
  if (!group) return { error: notFound("Expense group", v.groupId) };
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
    const taken = await tx.link.findFirst({
      where: { kind: "created_from", toType: "document", toId: v.documentId },
      select: { fromType: true, fromId: true },
    });
    if (taken)
      return {
        error: violation(
          `Document ${doc.data.businessKey} already became ${taken.fromType} ${taken.fromId}`,
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
      note: v.note ?? null,
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
    newData: { ...toAuditData(row), lines: row.lines.length },
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
    if (v.partnerId !== undefined) {
      const supplier = await resolveSupplier(tx, partnerId);
      if (supplier.error) return { error: supplier.error };
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
    const dueDate =
      v.dueDate ??
      (v.invoiceDate
        ? addDays(invoiceDate, DEFAULT_PAYMENT_TERMS_DAYS)
        : (iso(row.dueDate) as string));
    if (dueDate < invoiceDate)
      return { error: invalid("The due date cannot be before the invoice date") };
    const currency = v.currency ?? row.currency;
    const base = await baseFor(tx, invoiceDate, new D(total), currency, v.rate);
    if (base.error) return { error: base.error };
    Object.assign(data, {
      partnerId,
      invoiceNumber,
      invoiceDate: new Date(invoiceDate),
      dueDate: new Date(dueDate),
      dueDateDefaulted: v.dueDate ? false : row.dueDateDefaulted,
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

/** "Copy last": the supplier's latest invoice as a prefill — amounts, category, registration; a new number and dates. */
export async function copyLastPrefill(
  tx: TransactionClient,
  partnerId: string,
): Promise<
  ServiceResult<Pick<
    SupplierInvoiceDto,
    | "currency"
    | "amountNet"
    | "vatAmount"
    | "amountTotal"
    | "basCode"
    | "vatRegistrationId"
    | "note"
    | "groupId"
  > | null>
> {
  const row = await tx.supplierInvoice.findFirst({
    where: { partnerId, cancelled: false },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  });
  if (!row) return { data: null };
  const dto = toSupplierInvoiceDto(row);
  return {
    data: {
      currency: dto.currency,
      amountNet: dto.amountNet,
      vatAmount: dto.vatAmount,
      amountTotal: dto.amountTotal,
      basCode: dto.basCode,
      vatRegistrationId: dto.vatRegistrationId,
      note: dto.note,
      groupId: dto.groupId,
    },
  };
}

export async function getSupplierInvoice(
  tx: TransactionClient,
  id: string,
): Promise<SupplierInvoiceDto | null> {
  const row = await tx.supplierInvoice.findUnique({ where: { id }, include: { lines: true } });
  return row ? toSupplierInvoiceDto(row) : null;
}
