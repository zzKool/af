// Invoices service — quotes, invoices, credit notes (specs/invoices/spec.md, D7, D21, D22, D23).
// Drafts are editable; `issue` numbers, converts, snapshots and locks in ONE transaction; after that only
// hand-set facts change (sent, quote decision, declaration period override). Everything else is derived
// in queries.ts. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { Invoice, InvoiceLine } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY, CURRENCIES } from "@/kernel/nav/constants";
import * as banking from "@/modules/banking";
import * as contracts from "@/modules/contracts";
import { RATE_UNITS, type RateUnit } from "@/modules/contracts";
import * as numbering from "@/modules/numbering";
import * as partners from "@/modules/partners";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import { declarationPeriodFor, isDeclarationPeriod } from "./derive";
import { invoiceTotals, type LineInput, TotalsError } from "./totals";
import type {
  InvoiceDto,
  InvoiceLineDto,
  InvoiceType,
  PrintedParties,
  PrintedReference,
  VatByRate,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

const violation = (message: string, details?: Record<string, string | number>): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});
const invalid = (message: string): AppError => ({
  code: "VALIDATION_ERROR",
  message,
  retryable: false,
});
const notFound = (what: string, id: string): AppError => ({
  code: "NOT_FOUND",
  message: `${what} not found: ${id}`,
  retryable: false,
});

// --- Zod schemas (the boundary) ---

const isoDate = z.string().date();
const money2 = z.string().regex(/^\d+(\.\d{1,2})?$/, "Use digits with up to 2 decimals");
const percent = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Use digits with up to 2 decimals")
  .refine((v) => Number(v) <= 100, "At most 100");
const uuid = z.string().uuid();

export const lineInputSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(5000),
  quantity: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, "Quantity: digits with up to 4 decimals")
    .refine((v) => Number(v) <= 999999.9999, "Quantity too large"),
  unit: z.enum(RATE_UNITS as [RateUnit, ...RateUnit[]]).default("day"),
  unitPrice: money2,
  discountPercent: percent.nullable().optional(),
  discountFixed: money2.nullable().optional(),
  vatRate: percent,
  periodStart: isoDate.nullable().optional(),
  periodEnd: isoDate.nullable().optional(),
  rateSourceId: uuid.nullable().optional(),
});
export type LineInputDto = z.input<typeof lineInputSchema>;

const referenceSchema = z.object({
  label: z.string().trim().min(1).max(50),
  value: z.string().trim().min(1).max(100),
});

const headerFields = {
  contractId: uuid.nullable().optional(),
  vatRegistrationId: uuid.nullable().optional(),
  issueDate: isoDate.optional(),
  dueDate: isoDate.nullable().optional(),
  periodLabel: z.string().trim().max(100).nullable().optional(),
  periodStart: isoDate.nullable().optional(),
  periodEnd: isoDate.nullable().optional(),
  currency: z.enum(CURRENCIES).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
  printedReferences: z.array(referenceSchema).max(10).optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
  internalNote: z.string().trim().max(10000).nullable().optional(),
  paymentTermsText: z.string().trim().max(1000).nullable().optional(),
  discountPercent: percent.nullable().optional(),
};

export const createDraftSchema = z.object({
  type: z.enum(["invoice", "quote"]).default("invoice"),
  partnerId: uuid,
  ...headerFields,
  lines: z.array(lineInputSchema).max(200).optional(),
});
export type CreateDraftInput = z.input<typeof createDraftSchema>;

export const updateDraftSchema = z.object({
  id: uuid,
  ...headerFields,
  lines: z.array(lineInputSchema).max(200).optional(),
});
export type UpdateDraftInput = z.input<typeof updateDraftSchema>;

export const issueSchema = z.object({ id: uuid, issueDate: isoDate.optional() });
export type IssueInput = z.input<typeof issueSchema>;

export const creditNoteSchema = z.object({
  originalId: uuid,
  /** omitted = full credit; otherwise the lines to credit with the quantity to credit on each */
  lines: z
    .array(z.object({ lineId: uuid, quantity: z.string().regex(/^\d+(\.\d{1,4})?$/) }))
    .min(1)
    .optional(),
});
export type CreditNoteInput = z.input<typeof creditNoteSchema>;

export const declarationPeriodSchema = z.object({
  id: uuid,
  declarationPeriod: z
    .string()
    .trim()
    .refine((v) => isDeclarationPeriod(v), "Expected a period like CH 2026/Q1")
    .nullable(),
});

// --- DTO mapping ---

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const str = (d: Dec | null): string | null => (d ? d.toFixed(2) : null);

export function toLineDto(row: InvoiceLine): InvoiceLineDto {
  return {
    id: row.id,
    lineNo: row.lineNo,
    description: row.description,
    quantity: row.quantity.toString(),
    unit: row.unit,
    unitPrice: row.unitPrice.toFixed(2),
    discountPercent: row.discountPercent ? row.discountPercent.toString() : null,
    discountAmount: row.discountAmount.toFixed(2),
    netAmount: row.netAmount.toFixed(2),
    vatRate: row.vatRate.toString(),
    vatAmount: row.vatAmount.toFixed(2),
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    rateSourceId: row.rateSourceId,
  };
}

export function toInvoiceDto(row: Invoice & { lines: InvoiceLine[] }): InvoiceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    status: row.status,
    number: row.number,
    partnerId: row.partnerId,
    contractId: row.contractId,
    vatRegistrationId: row.vatRegistrationId,
    relatedInvoiceId: row.relatedInvoiceId,
    issueDate: iso(row.issueDate) as string,
    dueDate: iso(row.dueDate),
    periodLabel: row.periodLabel,
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    currency: row.currency,
    language: row.language,
    printedReferences: (row.printedReferences as PrintedReference[] | null) ?? [],
    printedParties: (row.printedParties as PrintedParties | null) ?? null,
    notes: row.notes,
    internalNote: row.internalNote,
    paymentTermsText: row.paymentTermsText,
    discountPercent: row.discountPercent ? row.discountPercent.toString() : null,
    subtotal: row.subtotal.toFixed(2),
    discountAmount: row.discountAmount.toFixed(2),
    netAmount: row.netAmount.toFixed(2),
    vatAmount: row.vatAmount.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    vatByRate: (row.vatByRate as VatByRate[] | null) ?? [],
    baseCurrency: row.baseCurrency,
    rateToBase: row.rateToBase ? row.rateToBase.toString() : null,
    rateSource: row.rateSource,
    rateDate: iso(row.rateDate),
    subtotalBase: str(row.subtotalBase),
    vatBase: str(row.vatBase),
    totalBase: str(row.totalBase),
    declarationPeriod: row.declarationPeriod,
    pdfDocumentId: row.pdfDocumentId,
    issuedAt: row.issuedAt,
    sentAt: row.sentAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
    lines: [...row.lines].sort((a, b) => a.lineNo - b.lineNo).map(toLineDto),
  };
}

const withLines = { lines: true } as const;

async function load(tx: TransactionClient, id: string) {
  return tx.invoice.findUnique({ where: { id }, include: withLines });
}

// --- defaults chain (partner → contract → registration) ---

const SWISS = new Set(["ch", "che", "switzerland", "suisse", "schweiz", "svizzera"]);
const SWEDISH = new Set(["se", "swe", "sweden", "sverige", "suède"]);
const EU = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

function norm(country: string | null | undefined): string {
  return (country ?? "").trim().toLowerCase();
}
export const isSwissCountry = (c: string | null | undefined): boolean =>
  norm(c) === "" || SWISS.has(norm(c));
export const isSwedishCountry = (c: string | null | undefined): boolean =>
  norm(c) === "" || SWEDISH.has(norm(c));

type Registration = { id: string; country: string; vatNumber: string; rateSchedule: unknown };

function registrationRates(reg: Registration | null | undefined): string[] {
  const schedule = reg?.rateSchedule as { rates?: unknown } | null | undefined;
  const list = Array.isArray(schedule?.rates) ? schedule.rates : [];
  return list.filter((r): r is number => typeof r === "number").map((r) => new D(r).toString());
}

/**
 * The VAT treatment a document gets from its registration and the client's country (D23):
 * CH registration → Swiss client at the standard rate, foreign client 0 % (export, ref 221);
 * SE registration → Swedish client at the standard rate, EU business with a VAT number 0 % (reverse charge),
 * other countries 0 % (export); any other registration → its standard rate.
 */
export type VatTreatment = "standard" | "reverse_charge" | "export" | "none";

export function vatTreatmentFor(
  reg: Registration | null | undefined,
  partner: { address: { country?: string } | null; vatNumber: string | null },
): { treatment: VatTreatment; rate: string; rates: string[] } {
  const rateList = registrationRates(reg);
  const standard = rateList[0] ?? "0";
  if (!reg) return { treatment: "none", rate: "0", rates: [] };
  const country = partner.address?.country ?? null;
  const code = (country ?? "").trim().toUpperCase();
  if (reg.country === "CH") {
    return isSwissCountry(country)
      ? { treatment: "standard", rate: standard, rates: rateList }
      : { treatment: "export", rate: "0", rates: rateList };
  }
  if (reg.country === "SE") {
    if (isSwedishCountry(country))
      return { treatment: "standard", rate: standard, rates: rateList };
    if (EU.has(code) && partner.vatNumber)
      return { treatment: "reverse_charge", rate: "0", rates: rateList };
    return { treatment: "export", rate: "0", rates: rateList };
  }
  return { treatment: "standard", rate: standard, rates: rateList };
}

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

async function registrationById(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string | null | undefined,
): Promise<Registration | null> {
  if (!id) return null;
  const regs = await settings.getVatRegistrations(tx, caller);
  return regs.data?.find((r) => r.id === id) ?? null;
}

function parseError(e: z.ZodError): AppError {
  return invalid(e.issues[0]?.message ?? "Invalid input");
}

function lineRowsFrom(
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

function totalsData(lines: z.output<typeof lineInputSchema>[], discountPercent: string | null) {
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

function linesToInput(lines: InvoiceLine[]): z.output<typeof lineInputSchema>[] {
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

// --- writes ---

/**
 * A new draft. With a contract: currency, due date (payment terms), VAT registration, language, printed
 * references and one pre-filled line (contract rate valid on period start, registration VAT) come from it.
 */
export async function createDraft(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  today: string,
  input: CreateDraftInput,
): Promise<ServiceResult<InvoiceDto>> {
  const parsed = createDraftSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const data = parsed.data;

  const partner = await partners.getPartner(tx, data.partnerId);
  if (!partner.data) return { error: notFound("Partner", data.partnerId) };
  if (!partner.data.types.includes("client"))
    return { error: violation(`${partner.data.name} is not a client`) };

  let contract: contracts.ContractDto | null = null;
  if (data.contractId) {
    const c = await contracts.getContract(tx, data.contractId);
    if (!c.data) return { error: notFound("Contract", data.contractId) };
    if (c.data.partnerId !== partner.data.id)
      return { error: violation("The contract belongs to another partner") };
    contract = c.data;
  }

  const issueDate = data.issueDate ?? today;
  const currency =
    data.currency ??
    (contract?.currency as (typeof CURRENCIES)[number] | null | undefined) ??
    (partner.data.defaultCurrency as (typeof CURRENCIES)[number] | null) ??
    BASE_CURRENCY;
  const vatRegistrationId =
    data.vatRegistrationId === undefined
      ? (contract?.vatRegistrationId ?? null)
      : data.vatRegistrationId;
  const registration = await registrationById(tx, caller, vatRegistrationId);
  if (vatRegistrationId && !registration)
    return { error: notFound("VAT registration", vatRegistrationId) };
  const vat = vatTreatmentFor(registration, partner.data);
  const dueDate =
    data.dueDate !== undefined
      ? data.dueDate
      : data.type === "quote"
        ? addDays(issueDate, 30)
        : dueDateFor(issueDate, contract?.paymentTerms);
  if (dueDate && dueDate < issueDate)
    return { error: invalid("Due date must be on or after the issue date") };

  const printedReferences: PrintedReference[] = data.printedReferences ?? [
    ...partner.data.externalIdentifiers,
    ...(contract?.externalReferences ?? []),
  ];

  let lines = data.lines ?? [];
  if (!data.lines && contract) {
    const rate = await contracts.rateFor(tx, contract.id, data.periodStart ?? issueDate);
    lines = [
      {
        description: "Consulting services",
        quantity: "1",
        unit: rate?.unit ?? "day",
        unitPrice: rate?.rate ?? "0.00",
        vatRate: vat.rate,
        rateSourceId: rate?.id ?? null,
        periodStart: data.periodStart ?? null,
        periodEnd: data.periodEnd ?? null,
      },
    ];
  }
  const lineRows = lineRowsFrom(caller.tenantId, lines);
  if (!Array.isArray(lineRows)) return { error: lineRows };

  const row = await tx.invoice.create({
    data: {
      tenantId: caller.tenantId,
      type: data.type,
      status: "draft",
      partnerId: partner.data.id,
      contractId: contract?.id ?? null,
      vatRegistrationId,
      issueDate: toDate(issueDate),
      dueDate: dueDate ? toDate(dueDate) : null,
      periodLabel: data.periodLabel ?? null,
      periodStart: data.periodStart ? toDate(data.periodStart) : null,
      periodEnd: data.periodEnd ? toDate(data.periodEnd) : null,
      currency,
      language: data.language ?? partner.data.defaultLanguage ?? "en",
      printedReferences: printedReferences as unknown as Prisma.InputJsonValue,
      notes: data.notes ?? null,
      internalNote: data.internalNote ?? null,
      paymentTermsText: data.paymentTermsText ?? null,
      discountPercent: data.discountPercent ? new D(data.discountPercent) : null,
      ...totalsData(lines, data.discountPercent ?? null),
      baseCurrency: BASE_CURRENCY,
      createdBy: caller.userId,
      source: caller.source,
      lines: { createMany: { data: lineRows } },
    },
    include: withLines,
  });
  const dto = toInvoiceDto(row);
  await audit.log({
    action: "create",
    entityType: "invoice",
    entityId: row.id,
    newData: toAuditData(dto),
  });
  return { data: dto };
}

/** Edit a draft's header and/or replace its lines wholesale; totals are recomputed and stored. */
export async function updateDraft(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: UpdateDraftInput,
): Promise<ServiceResult<InvoiceDto>> {
  const parsed = updateDraftSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const { id, lines, ...data } = parsed.data;
  const row = await load(tx, id);
  if (!row) return { error: notFound("Invoice", id) };
  if (row.status !== "draft")
    return { error: violation("Only drafts can be edited — issue a credit note") };
  const before = toInvoiceDto(row);

  const issueDate = data.issueDate ?? before.issueDate;
  const dueDate = data.dueDate === undefined ? before.dueDate : data.dueDate;
  if (dueDate && dueDate < issueDate)
    return { error: invalid("Due date must be on or after the issue date") };
  if (data.vatRegistrationId) {
    const reg = await registrationById(tx, caller, data.vatRegistrationId);
    if (!reg) return { error: notFound("VAT registration", data.vatRegistrationId) };
  }
  if (data.contractId) {
    const c = await contracts.getContract(tx, data.contractId);
    if (!c.data) return { error: notFound("Contract", data.contractId) };
    if (c.data.partnerId !== row.partnerId)
      return { error: violation("The contract belongs to another partner") };
  }

  const nextLines = lines ?? linesToInput(row.lines);
  const discountPercent =
    data.discountPercent === undefined ? before.discountPercent : data.discountPercent;
  const lineRows = lineRowsFrom(caller.tenantId, nextLines);
  if (!Array.isArray(lineRows)) return { error: lineRows };
  let totals: ReturnType<typeof totalsData>;
  try {
    totals = totalsData(nextLines, discountPercent);
  } catch (e) {
    if (e instanceof TotalsError) return { error: invalid(e.message) };
    throw e;
  }

  const update: Prisma.InvoiceUpdateInput = {
    ...totals,
    discountPercent: discountPercent ? new D(discountPercent) : null,
  };
  if (data.contractId !== undefined) update.contractId = data.contractId;
  if (data.vatRegistrationId !== undefined) update.vatRegistrationId = data.vatRegistrationId;
  if (data.issueDate !== undefined) update.issueDate = toDate(data.issueDate);
  if (data.dueDate !== undefined) update.dueDate = data.dueDate ? toDate(data.dueDate) : null;
  if (data.periodLabel !== undefined) update.periodLabel = data.periodLabel;
  if (data.periodStart !== undefined)
    update.periodStart = data.periodStart ? toDate(data.periodStart) : null;
  if (data.periodEnd !== undefined)
    update.periodEnd = data.periodEnd ? toDate(data.periodEnd) : null;
  if (data.currency !== undefined) update.currency = data.currency;
  if (data.language !== undefined) update.language = data.language;
  if (data.printedReferences !== undefined)
    update.printedReferences = data.printedReferences as unknown as Prisma.InputJsonValue;
  if (data.notes !== undefined) update.notes = data.notes;
  if (data.internalNote !== undefined) update.internalNote = data.internalNote;
  if (data.paymentTermsText !== undefined) update.paymentTermsText = data.paymentTermsText;
  if (lines) update.lines = { deleteMany: {}, createMany: { data: lineRows } };

  const updated = await tx.invoice.update({ where: { id }, data: update, include: withLines });
  const dto = toInvoiceDto(updated);
  await audit.log({
    action: "update",
    entityType: "invoice",
    entityId: id,
    oldData: toAuditData(before),
    newData: toAuditData(dto),
  });
  return { data: dto };
}

export async function deleteDraft(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ id: string }>> {
  const row = await load(tx, id);
  if (!row) return { error: notFound("Invoice", id) };
  if (row.status !== "draft") return { error: violation("Only drafts can be deleted") };
  void caller;
  await tx.invoice.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "invoice",
    entityId: id,
    oldData: toAuditData(toInvoiceDto(row)),
  });
  return { data: { id } };
}

function seriesFor(type: InvoiceType, shortCode: string, issueDate: string): string {
  if (type === "quote") return numbering.quoteSeries(shortCode, issueDate);
  if (type === "credit_note") return numbering.creditNoteSeries(shortCode, issueDate);
  return numbering.invoiceSeries(shortCode, issueDate);
}

/**
 * Issue a draft: validate, take the number (row-locked, same transaction), convert to the base currency with
 * the ECB rate of the issue date, derive the declaration period, snapshot the printed parties, lock.
 * The PDF is rendered afterwards by the render job (part 2) — never inside this transaction.
 */
export async function issue(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  now: Date,
  input: IssueInput,
): Promise<ServiceResult<InvoiceDto>> {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const row = await load(tx, parsed.data.id);
  if (!row) return { error: notFound("Invoice", parsed.data.id) };
  if (row.status !== "draft") return { error: violation(`${row.number} is already issued`) };
  const before = toInvoiceDto(row);
  const issueDate = parsed.data.issueDate ?? before.issueDate;

  // validations that only matter at issue
  if (row.lines.length === 0) return { error: invalid("At least one line is required") };
  if (row.lines.some((l) => l.description.trim() === ""))
    return { error: invalid("Every line needs a description") };
  if (before.dueDate && before.dueDate < issueDate)
    return { error: invalid("Due date must be on or after the issue date") };
  const partner = await partners.getPartner(tx, row.partnerId);
  if (!partner.data) return { error: notFound("Partner", row.partnerId) };
  if (!partner.data.shortCode)
    return {
      error: violation(`${partner.data.name} needs a short code (the invoice series)`, {
        partnerId: partner.data.id,
      }),
    };
  if (row.type === "credit_note") {
    const check = await creditLimit(tx, row);
    if (check) return { error: check };
  }

  // base currency (D3/D4) — never a silent null
  const base = await rates.rateToBase(tx, issueDate, row.currency, row.baseCurrency);
  if (!base)
    return {
      error: violation(
        `No exchange rate ${row.currency}/${row.baseCurrency} for ${issueDate} — run the ECB sync`,
      ),
    };
  const toBase = (d: Dec) => d.mul(base.rate).toDecimalPlaces(2, D.ROUND_HALF_UP);

  // declaration period (D12/D23): CH-registration invoices and credit notes
  const registration = await registrationById(tx, caller, row.vatRegistrationId);
  const declarationPeriod =
    registration?.country === "CH" && row.type !== "quote"
      ? declarationPeriodFor("CH", issueDate)
      : null;

  // printed parties snapshot
  const profile = await settings.getTenantProfile(tx, caller);
  const accounts = await banking.getBankAccounts(tx, caller);
  const bank =
    accounts.data?.find((a) => a.currency === row.currency) ??
    accounts.data?.find((a) => a.currency === row.baseCurrency) ??
    null;
  const printedParties: PrintedParties = {
    tenant: {
      name: profile.data?.name ?? "",
      orgNumber: profile.data?.orgNumber ?? null,
      address: profile.data?.address ?? null,
      email: null,
      website: null,
      logoUrl: null,
      vatNumber: registration?.vatNumber ?? null,
      vatCountry: registration?.country ?? null,
    },
    partner: {
      name: partner.data.name,
      address: partner.data.address,
      vatNumber: partner.data.vatNumber,
      orgNumber: partner.data.orgNumber,
      email: partner.data.email,
    },
    bank: bank
      ? {
          bankName: bank.bankFormat?.bankName ?? null,
          accountHolder: profile.data?.name ?? null,
          iban: null,
          bic: null,
          accountNumber: bank.accountNumber,
          currency: bank.currency,
        }
      : null,
  };

  // the number — last, after everything that can still fail (numbering spec R1)
  const series = seriesFor(row.type, partner.data.shortCode, issueDate);
  const seq = await numbering.nextInSeries(tx, caller, series);
  const number = numbering.formatSeriesNumber(series, seq);

  const updated = await tx.invoice.update({
    where: { id: row.id },
    data: {
      status: "issued",
      number,
      issueDate: toDate(issueDate),
      issuedAt: now,
      rateToBase: base.rate,
      rateSource: base.source,
      rateDate: toDate(base.rateDate),
      subtotalBase: toBase(row.subtotal),
      vatBase: toBase(row.vatAmount),
      // the base total is the sum of the converted parts, so the SEK figures reconcile line by line
      totalBase: toBase(row.subtotal.sub(row.discountAmount)).add(toBase(row.vatAmount)),
      declarationPeriod,
      printedParties: printedParties as unknown as Prisma.InputJsonValue,
    },
    include: withLines,
  });
  const dto = toInvoiceDto(updated);
  await audit.log({
    action: "update",
    entityType: "invoice",
    entityId: row.id,
    oldData: toAuditData({ ...before, event: "issue" }),
    newData: toAuditData({ ...dto, event: "issue" }),
  });
  return { data: dto };
}

/** Σ issued credit notes of the original + this one must not exceed the original's total. */
async function creditLimit(
  tx: TransactionClient,
  creditNote: Invoice & { lines: InvoiceLine[] },
): Promise<AppError | null> {
  if (!creditNote.relatedInvoiceId) return violation("A credit note needs its original invoice");
  const original = await tx.invoice.findUnique({ where: { id: creditNote.relatedInvoiceId } });
  if (!original) return notFound("Original invoice", creditNote.relatedInvoiceId);
  if (original.status === "draft") return violation("The original invoice is not issued");
  const issued = await tx.invoice.aggregate({
    where: { relatedInvoiceId: original.id, type: "credit_note", status: { not: "draft" } },
    _sum: { totalAmount: true },
  });
  const already = issued._sum.totalAmount ?? new D(0);
  if (already.add(creditNote.totalAmount).gt(original.totalAmount)) {
    return violation(
      `Credit notes would exceed the original: ${already.toFixed(2)} already credited + ${creditNote.totalAmount.toFixed(2)} > ${original.totalAmount.toFixed(2)} ${original.currency}`,
    );
  }
  return null;
}

export async function markSent(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  now: Date,
  id: string,
): Promise<ServiceResult<InvoiceDto>> {
  const row = await load(tx, id);
  if (!row) return { error: notFound("Invoice", id) };
  if (row.status !== "issued")
    return { error: violation(`${row.number ?? "Draft"} is ${row.status}, not issued`) };
  void caller;
  const updated = await tx.invoice.update({
    where: { id },
    data: { status: "sent", sentAt: now },
    include: withLines,
  });
  await audit.log({
    action: "update",
    entityType: "invoice",
    entityId: id,
    oldData: { status: "issued" },
    newData: { status: "sent", sentAt: now.toISOString() },
  });
  return { data: toInvoiceDto(updated) };
}

/** A quote the client answered. */
export async function decideQuote(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  now: Date,
  id: string,
  decision: "accepted" | "declined",
): Promise<ServiceResult<InvoiceDto>> {
  const row = await load(tx, id);
  if (!row) return { error: notFound("Quote", id) };
  if (row.type !== "quote") return { error: violation("Only quotes are accepted or declined") };
  if (row.status !== "issued" && row.status !== "sent")
    return { error: violation(`${row.number ?? "Draft"} is ${row.status}`) };
  void caller;
  const updated = await tx.invoice.update({
    where: { id },
    data: { status: decision, decidedAt: now },
    include: withLines,
  });
  await audit.log({
    action: "update",
    entityType: "invoice",
    entityId: id,
    oldData: { status: row.status },
    newData: { status: decision, decidedAt: now.toISOString() },
  });
  return { data: toInvoiceDto(updated) };
}

/** A new invoice draft from an issued (or accepted) quote, remembering its source. */
export async function convertQuote(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  today: string,
  id: string,
): Promise<ServiceResult<InvoiceDto>> {
  const row = await load(tx, id);
  if (!row) return { error: notFound("Quote", id) };
  if (row.type !== "quote") return { error: violation("Only quotes are converted") };
  if (row.status === "draft" || row.status === "declined")
    return { error: violation(`A ${row.status} quote cannot be converted`) };
  const existing = await tx.invoice.findFirst({
    where: { relatedInvoiceId: id, type: "invoice" },
    select: { id: true, number: true, status: true },
  });
  if (existing)
    return {
      error: violation(`${row.number} was already converted (${existing.number ?? "draft"})`, {
        invoiceId: existing.id,
      }),
    };
  const contract = row.contractId ? (await contracts.getContract(tx, row.contractId)).data : null;
  return copyInternal(tx, caller, audit, row, {
    type: "invoice",
    relatedInvoiceId: id,
    issueDate: today,
    dueDate: dueDateFor(today, contract?.paymentTerms),
    event: "convert",
  });
}

/** Any document as a fresh draft of the same kind (credit notes copy as invoices), unrelated to the source. */
export async function copyToDraft(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  today: string,
  id: string,
): Promise<ServiceResult<InvoiceDto>> {
  const row = await load(tx, id);
  if (!row) return { error: notFound("Invoice", id) };
  const type: InvoiceType = row.type === "credit_note" ? "invoice" : row.type;
  const contract = row.contractId ? (await contracts.getContract(tx, row.contractId)).data : null;
  return copyInternal(tx, caller, audit, row, {
    type,
    relatedInvoiceId: null,
    issueDate: today,
    dueDate: type === "quote" ? addDays(today, 30) : dueDateFor(today, contract?.paymentTerms),
    event: "copy",
  });
}

async function copyInternal(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  source: Invoice & { lines: InvoiceLine[] },
  opts: {
    type: InvoiceType;
    relatedInvoiceId: string | null;
    issueDate: string;
    dueDate: string | null;
    event: string;
    lines?: z.output<typeof lineInputSchema>[];
    internalNote?: string;
  },
): Promise<ServiceResult<InvoiceDto>> {
  const lines = opts.lines ?? linesToInput(source.lines);
  const lineRows = lineRowsFrom(caller.tenantId, lines);
  if (!Array.isArray(lineRows)) return { error: lineRows };
  const discountPercent = source.discountPercent ? source.discountPercent.toString() : null;
  const created = await tx.invoice.create({
    data: {
      tenantId: caller.tenantId,
      type: opts.type,
      status: "draft",
      partnerId: source.partnerId,
      contractId: source.contractId,
      vatRegistrationId: source.vatRegistrationId,
      relatedInvoiceId: opts.relatedInvoiceId,
      issueDate: toDate(opts.issueDate),
      dueDate: opts.dueDate ? toDate(opts.dueDate) : null,
      periodLabel: source.periodLabel,
      periodStart: source.periodStart,
      periodEnd: source.periodEnd,
      currency: source.currency,
      language: source.language,
      printedReferences: source.printedReferences as Prisma.InputJsonValue,
      notes: source.notes,
      internalNote: opts.internalNote ?? source.internalNote,
      paymentTermsText: source.paymentTermsText,
      discountPercent: source.discountPercent,
      ...totalsData(lines, discountPercent),
      baseCurrency: source.baseCurrency,
      createdBy: caller.userId,
      source: caller.source,
      lines: { createMany: { data: lineRows } },
    },
    include: withLines,
  });
  const dto = toInvoiceDto(created);
  await audit.log({
    action: "create",
    entityType: "invoice",
    entityId: created.id,
    newData: toAuditData({ ...dto, event: opts.event, sourceId: source.id }),
  });
  return { data: dto };
}

/**
 * A credit-note draft from an issued invoice: all lines in full, or the given lines with the quantity to
 * credit (a percent discount follows; a fixed discount is scaled by quantity). Issued like an invoice.
 */
export async function createCreditNote(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  today: string,
  input: CreditNoteInput,
): Promise<ServiceResult<InvoiceDto>> {
  const parsed = creditNoteSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const original = await load(tx, parsed.data.originalId);
  if (!original) return { error: notFound("Invoice", parsed.data.originalId) };
  if (original.type !== "invoice") return { error: violation("Only invoices are credited") };
  if (original.status === "draft")
    return { error: violation("Only issued invoices can be credited") };

  const wanted = parsed.data.lines;
  const sourceLines = [...original.lines].sort((a, b) => a.lineNo - b.lineNo);
  const lines: z.output<typeof lineInputSchema>[] = [];
  for (const l of sourceLines) {
    const pick = wanted
      ? wanted.find((w) => w.lineId === l.id)
      : { quantity: l.quantity.toString() };
    if (!pick) continue;
    const qty = new D(pick.quantity);
    if (qty.lte(0) || qty.gt(l.quantity))
      return {
        error: invalid(`Line ${l.lineNo}: credit quantity must be between 0 and ${l.quantity}`),
      };
    const ratio = l.quantity.isZero() ? new D(0) : qty.div(l.quantity);
    lines.push({
      description: `Credit: ${l.description}`,
      quantity: qty.toString(),
      unit: l.unit,
      unitPrice: l.unitPrice.toFixed(2),
      discountPercent: l.discountPercent ? l.discountPercent.toString() : null,
      discountFixed:
        l.discountPercent || l.discountAmount.isZero()
          ? null
          : l.discountAmount.mul(ratio).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
      vatRate: l.vatRate.toString(),
      periodStart: iso(l.periodStart),
      periodEnd: iso(l.periodEnd),
      rateSourceId: l.rateSourceId,
    });
  }
  if (wanted && lines.length !== wanted.length)
    return { error: invalid("A credited line does not belong to the invoice") };
  if (lines.length === 0) return { error: invalid("Nothing to credit") };

  return copyInternal(tx, caller, audit, original, {
    type: "credit_note",
    relatedInvoiceId: original.id,
    issueDate: today,
    dueDate: today,
    event: "credit_note",
    lines,
    internalNote: `Credit note for ${original.number}`,
  });
}

/** The one business field an issued CH document may change: which quarter it is declared in (audited). */
export async function setDeclarationPeriod(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: z.input<typeof declarationPeriodSchema>,
): Promise<ServiceResult<InvoiceDto>> {
  const parsed = declarationPeriodSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const row = await load(tx, parsed.data.id);
  if (!row) return { error: notFound("Invoice", parsed.data.id) };
  if (row.status === "draft") return { error: violation("Drafts have no declaration period yet") };
  if (row.type === "quote") return { error: violation("Quotes are not declared") };
  void caller;
  const updated = await tx.invoice.update({
    where: { id: row.id },
    data: { declarationPeriod: parsed.data.declarationPeriod },
    include: withLines,
  });
  await audit.log({
    action: "update",
    entityType: "invoice",
    entityId: row.id,
    oldData: { declarationPeriod: row.declarationPeriod },
    newData: { declarationPeriod: parsed.data.declarationPeriod },
  });
  return { data: toInvoiceDto(updated) };
}
