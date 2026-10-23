// Drafts: create (with the defaults chain), edit, delete. Only a draft changes freely.
import { Prisma } from "@/generated/prisma/browser";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import * as contracts from "@/modules/contracts";
import * as partners from "@/modules/partners";
import {
  dueDateFor,
  lineRowsFrom,
  linesToInput,
  QUOTE_VALIDITY_DAYS,
  registrationById,
  toCurrency,
  totalsData,
} from "./defaults";
import { load, toDate, toInvoiceDto, withLines } from "./dto";
import { invalid, notFound, parseError, violation } from "./errors";
import { printedReferencesToJson } from "./json-columns";
import {
  type CreateDraftInput,
  createDraftSchema,
  type UpdateDraftInput,
  updateDraftSchema,
} from "./schemas";
import { TotalsError } from "./totals";
import type { InvoiceDto, PrintedReference } from "./types";
import { vatTreatmentFor } from "./vat-treatment";

const D = Prisma.Decimal;

// --- writes: drafts ---

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
    toCurrency(contract?.currency) ??
    toCurrency(partner.data.defaultCurrency) ??
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
        ? addDays(issueDate, QUOTE_VALIDITY_DAYS)
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
      printedReferences: printedReferencesToJson(printedReferences),
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
    update.printedReferences = printedReferencesToJson(data.printedReferences);
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
