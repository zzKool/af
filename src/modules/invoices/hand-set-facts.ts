// After issue only hand-set facts change: sent, the quote's decision, the declaration period override, the reminder
// switch (F169).
import type { z } from "zod/v4";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { load, toInvoiceDto, withLines } from "./dto";
import { notFound, parseError, violation } from "./errors";
import { declarationPeriodSchema, reminderSchema } from "./schemas";
import type { InvoiceDto } from "./types";

// --- writes: hand-set facts ---

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

/**
 * F169, the board *Invoice studio*: "Draft a reminder if it is not paid 3 days after the due date" — on or off for one
 * invoice, a draft or an issued one (the lock lets this column through). Quotes and credit notes are never owed, so
 * they have no reminder. The app sends nothing: the switch only says whether the page drafts the reminder.
 */
export async function setReminder(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: z.input<typeof reminderSchema>,
): Promise<ServiceResult<InvoiceDto>> {
  const parsed = reminderSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const row = await load(tx, parsed.data.id);
  if (!row) return { error: notFound("Invoice", parsed.data.id) };
  if (row.type !== "invoice") return { error: violation("Only invoices have a reminder") };
  void caller;
  if (row.remindWhenLate === parsed.data.remindWhenLate) return { data: toInvoiceDto(row) };
  const updated = await tx.invoice.update({
    where: { id: row.id },
    data: { remindWhenLate: parsed.data.remindWhenLate },
    include: withLines,
  });
  await audit.log({
    action: "update",
    entityType: "invoice",
    entityId: row.id,
    oldData: { remindWhenLate: row.remindWhenLate },
    newData: { remindWhenLate: parsed.data.remindWhenLate },
  });
  return { data: toInvoiceDto(updated) };
}
