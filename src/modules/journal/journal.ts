// Journal service — the categorised ledger (specs/journal/spec.md, D1, D2, D3).
// Money facts (amount, currency, SEK base, rate, source, date, description) are written once; the owner's facts
// (category, partner, note, no document needed) change freely and never get overwritten by a rule.
// MUST NOT import from next/* or src/components/*. Never reads the banking tables — bank facts arrive as input.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { JournalEntry } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY, CURRENCIES } from "@/kernel/nav/constants";
import { basCode, isoDate, uuid } from "@/kernel/validation/scalars";
import * as partners from "@/modules/partners";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import { withImplicitRates } from "./implicit-rate";
import type {
  BankEntryInput,
  CategorisedBy,
  CategoriseInput,
  JournalEntryDto,
  JournalSource,
  RateSource,
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

// --- pure ---

/** round(amount × rate, 2) half-up; the sign follows the amount. */
export function baseAmount(amount: Dec | string, rate: Dec | string): Dec {
  const base = new D(amount).mul(new D(rate)).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return base.isZero() ? new D(0) : base; // never "-0"
}

// --- Zod schemas (the boundary) ---

const signedMoney = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Use digits with up to 2 decimals");
const positiveRate = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Use digits with up to 6 decimals")
  .refine((v) => Number(v) > 0, "The rate must be positive");

export const bankEntrySchema = z.object({
  sourceId: uuid,
  entryDate: isoDate,
  description: z.string().trim().min(1).max(2000),
  counterpartyKey: z.string().trim().min(1).max(500),
  amount: signedMoney,
  currency: z.enum(CURRENCIES),
});

export const manualEntrySchema = z.object({
  entryDate: isoDate,
  description: z.string().trim().min(1, "Description is required").max(2000),
  amount: signedMoney.refine((v) => Number(v) !== 0, "The amount cannot be zero"),
  currency: z.enum(CURRENCIES),
  /** typed by hand → rate_source = manual; omitted → ECB of the date */
  rate: positiveRate.optional(),
  basCode: basCode.nullable().optional(),
  partnerId: uuid.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  noDocumentNeeded: z.boolean().optional(),
});

export const categoriseSchema = z.object({
  basCode: basCode.nullable().optional(),
  partnerId: uuid.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  noDocumentNeeded: z.boolean().optional(),
});

export type ManualEntryInput = z.input<typeof manualEntrySchema>;

// --- DTO mapping (Prisma rows never leave the module) ---

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function toJournalEntryDto(row: JournalEntry): JournalEntryDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceType: row.sourceType as JournalSource,
    sourceId: row.sourceId,
    entryDate: iso(row.entryDate) ?? "",
    description: row.description,
    counterpartyKey: row.counterpartyKey,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    amountBase: row.amountBase.toFixed(2),
    rate: row.rate.toString(),
    rateSource: row.rateSource as RateSource,
    rateDate: iso(row.rateDate),
    // derived from the transfer link on read (T005, `withImplicitRates`); never stored (F86 dropped the column)
    bankImplicitRate: null,
    basCode: row.basCode,
    partnerId: row.partnerId,
    note: row.note,
    noDocumentNeeded: row.noDocumentNeeded,
    categorisedBy: (row.categorisedBy as CategorisedBy | null) ?? null,
    ruleId: row.ruleId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

/** One entry as read: the DTO with its derived facts (the implicit rate, T005). */
async function readDto(tx: TransactionClient, row: JournalEntry): Promise<JournalEntryDto> {
  const [dto] = await withImplicitRates(tx, [toJournalEntryDto(row)]);
  return dto as JournalEntryDto;
}

function parseError(e: z.ZodError): AppError {
  return invalid(e.issues[0]?.message ?? "Invalid input");
}

// --- the SEK base ---

type Base = { amountBase: Dec; rate: Dec; rateSource: RateSource; rateDate: string | null };

/** The rate that would convert `currency` on `date` — the banking import pre-checks every (date, currency) of a file before writing anything. */
export async function resolveRate(
  tx: TransactionClient,
  date: string,
  currency: string,
): Promise<ServiceResult<{ rate: string; rateSource: RateSource; rateDate: string | null }>> {
  const r = await baseFor(tx, date, new D(0), currency);
  if (r.error) return { error: r.error };
  return {
    data: {
      rate: r.data.rate.toString(),
      rateSource: r.data.rateSource,
      rateDate: r.data.rateDate,
    },
  };
}

/** The base of an amount on a date: SEK → 1 (`same_currency`); else the ECB rate of the date (nearest weekday). */
async function baseFor(
  tx: TransactionClient,
  date: string,
  amount: Dec,
  currency: string,
): Promise<ServiceResult<Base>> {
  const r = await rates.rateToBase(tx, date, currency, BASE_CURRENCY);
  if (!r) {
    return {
      error: violation(`No exchange rate for ${date} — run the ECB sync`, {
        date,
        currency,
      }),
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

// --- validation of the owner's facts ---

async function validateFacts(
  tx: TransactionClient,
  input: CategoriseInput,
): Promise<AppError | null> {
  if (input.basCode) {
    const cat = await settings.getBasCategory(tx, input.basCode);
    if (!cat) return notFound("BAS category", input.basCode);
  }
  if (input.partnerId) {
    const p = await partners.getPartner(tx, input.partnerId);
    if (!p.data) return notFound("Partner", input.partnerId);
  }
  return null;
}

// --- writes ---

/** One entry per new bank transaction (the import calls this inside its transaction). All or nothing. */
export async function createBankEntries(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  inputs: BankEntryInput[],
): Promise<ServiceResult<JournalEntryDto[]>> {
  const rows: Prisma.JournalEntryCreateManyInput[] = [];
  for (const raw of inputs) {
    const parsed = bankEntrySchema.safeParse(raw);
    if (!parsed.success) return { error: parseError(parsed.error) };
    const e = parsed.data;
    const base = await baseFor(tx, e.entryDate, new D(e.amount), e.currency);
    if (base.error) return { error: base.error };
    rows.push({
      tenantId: caller.tenantId,
      sourceType: "bank_transaction",
      sourceId: e.sourceId,
      entryDate: new Date(`${e.entryDate}T00:00:00Z`),
      description: e.description,
      counterpartyKey: e.counterpartyKey,
      amount: new D(e.amount),
      currency: e.currency,
      amountBase: base.data.amountBase,
      rate: base.data.rate,
      rateSource: base.data.rateSource,
      rateDate: base.data.rateDate ? new Date(`${base.data.rateDate}T00:00:00Z`) : null,
      createdBy: caller.userId,
      source: caller.source,
    });
  }
  if (rows.length === 0) return { data: [] };
  const created = await tx.journalEntry.createManyAndReturn({ data: rows });
  for (const row of created) {
    await audit.log({
      action: "create",
      entityType: "journal_entry",
      entityId: row.id,
      newData: toAuditData(row),
    });
  }
  // createManyAndReturn keeps the input order
  return { data: created.map(toJournalEntryDto) };
}

export async function createManualEntry(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: ManualEntryInput,
): Promise<ServiceResult<JournalEntryDto>> {
  const parsed = manualEntrySchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const e = parsed.data;
  const facts = await validateFacts(tx, e);
  if (facts) return { error: facts };

  let base: Base;
  if (e.rate) {
    if (e.currency === BASE_CURRENCY && !new D(e.rate).eq(1))
      return { error: invalid(`A ${BASE_CURRENCY} entry has rate 1`) };
    base = {
      amountBase: baseAmount(e.amount, e.rate),
      rate: new D(e.rate),
      rateSource: e.currency === BASE_CURRENCY ? "same_currency" : "manual",
      rateDate: null,
    };
  } else {
    const r = await baseFor(tx, e.entryDate, new D(e.amount), e.currency);
    if (r.error) return { error: r.error };
    base = r.data;
  }
  const categorised = e.basCode || e.partnerId ? "manual" : null;
  const row = await tx.journalEntry.create({
    data: {
      tenantId: caller.tenantId,
      sourceType: "manual",
      sourceId: null,
      entryDate: new Date(`${e.entryDate}T00:00:00Z`),
      description: e.description,
      counterpartyKey: null,
      amount: new D(e.amount),
      currency: e.currency,
      amountBase: base.amountBase,
      rate: base.rate,
      rateSource: base.rateSource,
      rateDate: base.rateDate ? new Date(`${base.rateDate}T00:00:00Z`) : null,
      basCode: e.basCode ?? null,
      partnerId: e.partnerId ?? null,
      note: e.note ?? null,
      noDocumentNeeded: e.noDocumentNeeded ?? false,
      categorisedBy: categorised,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "journal_entry",
    entityId: row.id,
    newData: toAuditData(row),
  });
  return { data: toJournalEntryDto(row) };
}

export type CategoriseOptions = {
  /** who is setting the facts: the owner (default) or a rule (then `ruleId`). Never `partner_default` (audit 32):
   * a rule that brings its partner's default category is still the rule — `rule_id` names it. */
  by?: Exclude<CategorisedBy, "partner_default">;
  ruleId?: string | null;
};

/**
 * Set the owner's facts. By hand: whatever is given is written, `categorised_by = manual`, the rule id cleared.
 * By a rule: category only when the entry has none, partner only when the entry has none, the flag OR-ed;
 * an entry categorised by hand is never touched (returns it unchanged).
 */
export async function categorise(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: CategoriseInput,
  options: CategoriseOptions = {},
): Promise<ServiceResult<JournalEntryDto>> {
  const parsed = categoriseSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const facts = parsed.data;
  const err = await validateFacts(tx, facts);
  if (err) return { error: err };

  const row = await tx.journalEntry.findUnique({ where: { id } });
  if (!row) return { error: notFound("Journal entry", id) };
  const by = options.by ?? "manual";

  let data: Prisma.JournalEntryUpdateInput;
  if (by === "manual") {
    data = {
      ...(facts.basCode !== undefined ? { basCode: facts.basCode } : {}),
      ...(facts.partnerId !== undefined ? { partnerId: facts.partnerId } : {}),
      ...(facts.note !== undefined ? { note: facts.note } : {}),
      ...(facts.noDocumentNeeded !== undefined ? { noDocumentNeeded: facts.noDocumentNeeded } : {}),
      categorisedBy: "manual",
      ruleId: null,
    };
  } else {
    if (row.categorisedBy === "manual") return { data: await readDto(tx, row) };
    const basCode = row.basCode ?? facts.basCode ?? null;
    const partnerId = row.partnerId ?? facts.partnerId ?? null;
    const noDocumentNeeded = row.noDocumentNeeded || (facts.noDocumentNeeded ?? false);
    if (
      basCode === row.basCode &&
      partnerId === row.partnerId &&
      noDocumentNeeded === row.noDocumentNeeded
    ) {
      return { data: await readDto(tx, row) };
    }
    data = {
      basCode,
      partnerId,
      noDocumentNeeded,
      categorisedBy: by,
      ruleId: by === "rule" ? (options.ruleId ?? null) : row.ruleId,
    };
  }
  const updated = await tx.journalEntry.update({ where: { id }, data });
  await audit.log({
    action: "update",
    entityType: "journal_entry",
    entityId: id,
    oldData: toAuditData(row),
    newData: toAuditData(updated),
  });
  return { data: await readDto(tx, updated) };
}

/** The banking import deletes its transactions' entries through this (nothing else reaches bank entries). */
export async function deleteBySource(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  sourceType: JournalSource,
  sourceIds: readonly string[],
): Promise<ServiceResult<{ deleted: number }>> {
  if (sourceIds.length === 0) return { data: { deleted: 0 } };
  const rows = await tx.journalEntry.findMany({
    where: { sourceType, sourceId: { in: [...sourceIds] } },
  });
  try {
    await tx.journalEntry.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  } catch (e) {
    if (isLinkedError(e))
      return { error: violation("A journal entry is linked and cannot be deleted") };
    throw e;
  }
  for (const row of rows) {
    await audit.log({
      action: "delete",
      entityType: "journal_entry",
      entityId: row.id,
      oldData: toAuditData(row),
    });
  }
  void caller;
  return { data: { deleted: rows.length } };
}

export async function deleteManualEntry(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ id: string }>> {
  const row = await tx.journalEntry.findUnique({ where: { id } });
  if (!row) return { error: notFound("Journal entry", id) };
  if (row.sourceType !== "manual")
    return { error: violation("A bank entry is deleted with its import, not by hand") };
  try {
    await tx.journalEntry.delete({ where: { id } });
  } catch (e) {
    if (isLinkedError(e)) return { error: violation("This entry is linked and cannot be deleted") };
    throw e;
  }
  await audit.log({
    action: "delete",
    entityType: "journal_entry",
    entityId: id,
    oldData: toAuditData(row),
  });
  void caller;
  return { data: { id } };
}

/** the `block_delete_when_linked` trigger (migration add_links) raises `document_linked` for every linkable table */
function isLinkedError(e: unknown): boolean {
  return e instanceof Error && e.message.includes("document_linked");
}

// --- reads ---

export async function getJournalEntry(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<JournalEntryDto>> {
  const row = await tx.journalEntry.findUnique({ where: { id } });
  if (!row) return { error: notFound("Journal entry", id) };
  return { data: await readDto(tx, row) };
}

/** The entries of a set of sources, keyed by source id (the banking workbench joins on it). */
export async function entriesForSources(
  tx: TransactionClient,
  sourceType: JournalSource,
  sourceIds: readonly string[],
): Promise<Map<string, JournalEntryDto>> {
  if (sourceIds.length === 0) return new Map();
  const rows = await tx.journalEntry.findMany({
    where: { sourceType, sourceId: { in: [...sourceIds] } },
  });
  const dtos = await withImplicitRates(tx, rows.map(toJournalEntryDto));
  return new Map(dtos.map((e) => [e.sourceId as string, e]));
}
