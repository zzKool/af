// The row's facts (F113, D59 — specs/banking/one-table.md): the bank row carries its SEK base (written once by the
// import, `bank_transactions_lock_facts`) and the owner's facts — category, partner, note, *no document needed* —
// which change freely through `categorise` and are never overwritten by a rule. What the journal module did for
// `journal_entries` until 2026-10-27, on the row itself. Never reads the links: `banking.actions` reads this file's
// schema at load time, and linking's registry loads every module — a static edge to linking from here would close
// the cycle the journal hid behind `await import` ([[lessons]] *module-load cycles*); the implied rate of a transfer
// pair is `implicit-rate.ts`, read by `queries.ts`. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { BankTransaction } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import { basCode, uuid } from "@/kernel/validation/scalars";
import * as partners from "@/modules/partners";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import { toTransactionDto } from "./dto";
import type { BankTransactionDto, CategorisedBy, CategoriseInput, RateSource } from "./types";

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

// --- Zod schema (the boundary) ---

export const categoriseSchema = z.object({
  basCode: basCode.nullable().optional(),
  partnerId: uuid.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  noDocumentNeeded: z.boolean().optional(),
});

function parseError(e: z.ZodError): AppError {
  return invalid(e.issues[0]?.message ?? "Invalid input");
}

// --- the SEK base ---

export type RowBase = {
  amountBase: Dec;
  rate: Dec;
  rateSource: RateSource;
  rateDate: string | null;
};

export type RowRate = { rate: string; rateSource: RateSource; rateDate: string | null };

/** The rate that converts `currency` on `date` — the import resolves every (date, currency) of a file before writing anything. */
export async function resolveRate(
  tx: TransactionClient,
  date: string,
  currency: string,
): Promise<ServiceResult<RowRate>> {
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
export async function baseFor(
  tx: TransactionClient,
  date: string,
  amount: Dec,
  currency: string,
): Promise<ServiceResult<RowBase>> {
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

// --- reads ---

/** The rows of `ids` as DTOs, keyed by id; an unknown id is absent. */
export async function transactionFacts(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, BankTransactionDto>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.bankTransaction.findMany({ where: { id: { in: unique } } });
  return new Map(rows.map((r) => [r.id, toTransactionDto(r)]));
}

/** The rows nothing has categorised yet, newest first — the candidates of an on-demand rules apply. */
export async function uncategorisedTransactions(
  tx: TransactionClient,
  limit: number,
): Promise<BankTransaction[]> {
  return tx.bankTransaction.findMany({
    where: { categorisedBy: null },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

// --- the owner's facts ---

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

export type CategoriseOptions = {
  /** who is setting the facts: the owner (default) or a rule (then `ruleId`). Never `partner_default` (audit 32):
   * a rule that brings its partner's default category is still the rule — `rule_id` names it. */
  by?: Exclude<CategorisedBy, "partner_default">;
  ruleId?: string | null;
};

/**
 * Set the owner's facts on a row. By hand: whatever is given is written, `categorised_by = manual`, the rule id
 * cleared. By a rule: category only when the row has none, partner only when the row has none, the flag OR-ed;
 * a row categorised by hand is never touched (returned unchanged). The money facts are out of reach: the
 * database refuses them (`bank_transactions_lock_facts`).
 */
export async function categorise(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: CategoriseInput,
  options: CategoriseOptions = {},
): Promise<ServiceResult<BankTransactionDto>> {
  const parsed = categoriseSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const facts = parsed.data;
  const err = await validateFacts(tx, facts);
  if (err) return { error: err };

  const row = await tx.bankTransaction.findUnique({ where: { id } });
  if (!row) return { error: notFound("Bank transaction", id) };
  const by = options.by ?? "manual";
  const unchanged = () => ({ data: toTransactionDto(row) });

  let data: Prisma.BankTransactionUncheckedUpdateInput;
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
    if (row.categorisedBy === "manual") return unchanged();
    const basCode = row.basCode ?? facts.basCode ?? null;
    const partnerId = row.partnerId ?? facts.partnerId ?? null;
    const noDocumentNeeded = row.noDocumentNeeded || (facts.noDocumentNeeded ?? false);
    if (
      basCode === row.basCode &&
      partnerId === row.partnerId &&
      noDocumentNeeded === row.noDocumentNeeded
    ) {
      return unchanged();
    }
    data = {
      basCode,
      partnerId,
      noDocumentNeeded,
      categorisedBy: by,
      ruleId: by === "rule" ? (options.ruleId ?? null) : row.ruleId,
    };
  }
  const updated = await tx.bankTransaction.update({ where: { id }, data });
  // the trail carries the owner's facts only: the bank's columns never change (the History reads the diff)
  await audit.log({
    action: "update",
    entityType: "bank_transaction",
    entityId: id,
    oldData: toAuditData(ownerFacts(row)),
    newData: toAuditData(ownerFacts(updated)),
  });
  return { data: toTransactionDto(updated) };
}

/** The owner's facts of a row — what a categorisation's audit row holds (the History diffs them). */
export function ownerFacts(row: BankTransaction) {
  return {
    basCode: row.basCode,
    partnerId: row.partnerId,
    note: row.note,
    noDocumentNeeded: row.noDocumentNeeded,
    categorisedBy: row.categorisedBy,
    ruleId: row.ruleId,
  };
}
