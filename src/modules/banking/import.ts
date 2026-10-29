// Bank import (specs/banking/spec.md US1, D25): one Nordea CSV → immutable transactions, each with its SEK base
// (F113: the row carries its facts), deduplicated per account, the file stored as a document, the rules applied
// to the new rows, one import record — all in the caller's transaction. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import type { Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { type AppError, RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import type { StorageService } from "@/kernel/storage/storage";
import { uuid } from "@/kernel/validation/scalars";
import * as documents from "@/modules/documents";
import * as linking from "@/modules/linking";
import * as numbering from "@/modules/numbering";
import { accountLabel } from "./bank-accounts";
import {
  type BankFormatConfig,
  headerError,
  type ParsedRow,
  parse,
  parseColumnMapping,
} from "./csv-parser";
import { baseAmount, type RowRate, resolveRate } from "./facts";
import { accountCompleteness } from "./queries";
import { applyToTransactions, ensureDefaultRules, ruleTarget } from "./rules";
import type { ImportSummary } from "./types";

const violation = (message: string, details?: Record<string, string | number>): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});
const invalid = (message: string, details?: Record<string, string | number>): AppError => ({
  code: "VALIDATION_ERROR",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});
const notFound = (what: string, id: string): AppError => ({
  code: "NOT_FOUND",
  message: `${what} not found: ${id}`,
  retryable: false,
});

export const importCsvSchema = z.object({
  bankAccountId: uuid,
  fileName: z.string().trim().min(1).max(255),
});

import { toImportDto } from "./dto";

export { toImportDto, toTransactionDto } from "./dto";

// --- pure: which parsed rows are new ---

export type DedupKey = `${string}#${number}`;
export const dedupKey = (hash: string, occurrence: number): DedupKey => `${hash}#${occurrence}`;

/** Split the parsed rows into new ones and duplicates against the keys already in the account. */
export function planImport<R extends { dedupHash: string; occurrence: number }>(
  existing: ReadonlySet<string>,
  rows: readonly R[],
): { fresh: R[]; duplicates: number } {
  const fresh: R[] = [];
  let duplicates = 0;
  for (const r of rows) {
    if (existing.has(dedupKey(r.dedupHash, r.occurrence))) duplicates++;
    else fresh.push(r);
  }
  return { fresh, duplicates };
}

/** Nothing but the header row is a "not this bank" check — exposed for the dialog's pre-parse. */
export function describeHeaderError(config: BankFormatConfig, firstLine: string): string | null {
  const header = firstLine.split(config.delimiter);
  return headerError(header, config);
}

// --- the import ---

export async function importCsv(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  storage: StorageService,
  input: { bankAccountId: string; fileName: string; bytes: Buffer },
): Promise<ServiceResult<ImportSummary>> {
  const parsed = importCsvSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  if (!input.bytes || input.bytes.length === 0)
    return { error: invalid("File is empty (0 bytes)") };

  const account = await tx.bankAccount.findUnique({
    where: { id: parsed.data.bankAccountId },
    include: { bankFormat: true },
  });
  if (!account) return { error: notFound("Bank account", parsed.data.bankAccountId) };
  const label = accountLabel(account);
  if (!account.bankFormat) {
    return { error: invalid(`${label} is a private instrument — it has no statement to import`) };
  }
  const config = formatConfig(account.bankFormat);
  const format = account.bankFormat;
  if (!config)
    return {
      error: invalid(`The ${format.name} format's column mapping is not readable`, {
        bankFormat: format.name,
      }),
    };

  // 1. parse — all or nothing (F109): a row the parser could not read fails the whole file, every bad row named
  const result = parse(input.bytes, config);
  if (result.rows.length === 0) {
    const first = result.errors[0] ?? "No data rows found";
    return {
      error: first.startsWith("Unexpected columns")
        ? invalid(`Not a ${format.bankName} export — ${first}`, {
            bankName: format.bankName,
          })
        : invalid(first),
    };
  }
  if (result.errors.length > 0) {
    const n = result.errors.length;
    return {
      error: invalid(
        `${n} row${n === 1 ? "" : "s"} could not be read — ${result.errors.slice(0, 3).join("; ")}${n > 3 ? "; …" : ""} — nothing was imported`,
        { errors: result.errors.join("\n"), rows: n },
      ),
    };
  }

  // 2. the file's currency must be the account's
  const foreign = result.rows.find((r) => r.currency !== account.currency);
  if (foreign) {
    return {
      error: violation(
        `Currency ${foreign.currency} in file does not match account ${label} (${account.currency})`,
        { fileCurrency: foreign.currency, accountCurrency: account.currency, account: label },
      ),
    };
  }

  // 3. dedup per account
  const hashes = [...new Set(result.rows.map((r) => r.dedupHash))];
  const existingRows = await tx.bankTransaction.findMany({
    where: { bankAccountId: account.id, dedupHash: { in: hashes } },
    select: { dedupHash: true, occurrence: true },
  });
  const existing = new Set(existingRows.map((e) => dedupKey(e.dedupHash, e.occurrence)));
  const { fresh, duplicates } = planImport(existing, result.rows);

  const dates = result.rows.map((r) => r.date).sort();
  const periodFrom = dates[0] ?? null;
  const periodTo = dates[dates.length - 1] ?? null;

  // 4. every new row needs a base rate — resolved before anything is written (a returned error does not
  //    roll the transaction back; a service never leaves half an import behind). SEK → 1 (`same_currency`);
  //    else the ECB rate of the booking date (nearest weekday) — the base rule, once (D3, F113)
  const rates = new Map<string, RowRate>();
  for (const date of [...new Set(fresh.map((r) => r.date))]) {
    const r = await resolveRate(tx, date, account.currency);
    if (r.error) return { error: r.error };
    rates.set(date, r.data);
  }

  // 5. the statement as a document (even when every row was a duplicate — the package needs the file);
  //    the blob goes out first: if a later step throws, the row rolls back and the blob is an orphan at worst
  const stored = await documents.storeGeneratedDocument(tx, caller, audit, storage, {
    bytes: input.bytes,
    businessKey: numbering.bankStatementKey(label, periodFrom, periodTo),
    fileName: parsed.data.fileName,
    mimeType: "text/csv",
    prefixType: "bank_statement",
  });
  if (stored.error) return { error: stored.error };

  // 6. the import record (the transactions reference it)
  const importRow = await tx.bankImport.create({
    data: {
      tenantId: caller.tenantId,
      bankAccountId: account.id,
      fileName: parsed.data.fileName,
      documentId: stored.data.id,
      recordCount: result.rows.length,
      importedCount: fresh.length,
      duplicateCount: duplicates,
      errorCount: 0, // a file with a bad row never gets here (F109); the columns stay for the history
      errors: [],
      periodFrom: periodFrom ? new Date(`${periodFrom}T00:00:00Z`) : null,
      periodTo: periodTo ? new Date(`${periodTo}T00:00:00Z`) : null,
      createdBy: caller.userId,
      source: caller.source,
    },
  });

  // 7. the transactions, in file order, each with its base (the rates were resolved above)
  const created = fresh.length
    ? await tx.bankTransaction.createManyAndReturn({
        data: fresh.map((r) =>
          transactionRow(caller, account.id, importRow.id, r, rates.get(r.date) as RowRate),
        ),
      })
    : [];
  for (const t of created) {
    await audit.log({
      action: "create",
      entityType: "bank_transaction",
      entityId: t.id,
      newData: toAuditData(t),
    });
  }

  // 8. rules on the new rows (the defaults first, when the tenant has none yet)
  const defaults = await ensureDefaultRules(tx, caller, audit);
  if (defaults.error) throw new RollbackError(defaults.error);
  const rules = await tx.categorisationRule.findMany({ where: { isActive: true } });
  const applied = await applyToTransactions(tx, caller, audit, rules, created.map(ruleTarget));
  if (applied.error) throw new RollbackError(applied.error);

  await audit.log({
    action: "create",
    entityType: "bank_import",
    entityId: importRow.id,
    newData: toAuditData(importRow),
  });

  // 9. the balance chain over the whole account (F115): reported, never refused — a gap between two exports
  //    is the owner's cue to export the missing days; a broken chain inside one file is the bank's to explain
  const chain = (await accountCompleteness(tx, [account.id])).get(account.id);

  return {
    data: {
      ...toImportDto(importRow),
      accountLabel: label,
      currency: account.currency,
      transactionIds: created.map((t) => t.id),
      categorised: applied.data.applied,
      completeTo: chain?.completeTo ?? null,
      balanceGaps: chain?.gaps ?? [],
    },
  };
}

function transactionRow(
  caller: CallerIdentity,
  bankAccountId: string,
  bankImportId: string,
  r: ParsedRow,
  base: RowRate,
): Prisma.BankTransactionCreateManyInput {
  return {
    tenantId: caller.tenantId,
    bankAccountId,
    bankImportId,
    bookingDate: new Date(`${r.date}T00:00:00Z`),
    amount: r.amount,
    currency: r.currency,
    balance: r.balance,
    sender: r.sender,
    recipient: r.recipient,
    name: r.name,
    additionalDetails: r.additionalDetails,
    message: r.message,
    ownNotes: r.ownNotes,
    description: r.description,
    reference: r.reference,
    counterpartyKey: r.counterpartyKey,
    dedupHash: r.dedupHash,
    occurrence: r.occurrence,
    rowIndex: r.rowIndex,
    amountBase: baseAmount(r.amount, base.rate),
    rate: base.rate,
    rateSource: base.rateSource,
    rateDate: base.rateDate ? new Date(`${base.rateDate}T00:00:00Z`) : null,
    createdBy: caller.userId,
    source: caller.source,
  };
}

/** The format row as the parser's config; null when its column mapping does not parse (`parseColumnMapping`). */
export function formatConfig(format: {
  delimiter: string;
  decimalSeparator: string;
  dateFormat: string;
  encoding: string;
  columnMapping: unknown;
}): BankFormatConfig | null {
  const columnMapping = parseColumnMapping(format.columnMapping);
  if (!columnMapping) return null;
  return {
    delimiter: format.delimiter,
    decimalSeparator: format.decimalSeparator,
    dateFormat: format.dateFormat,
    encoding: format.encoding,
    columnMapping,
  };
}

/** Delete an import with its transactions — refused when any transaction is linked. */
export async function deleteImport(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ id: string; deleted: number }>> {
  const row = await tx.bankImport.findUnique({ where: { id } });
  if (!row) return { error: notFound("Bank import", id) };
  const txs = await tx.bankTransaction.findMany({
    where: { bankImportId: id },
    select: { id: true },
  });
  const ids = txs.map((t) => t.id);
  if (ids.length) {
    const linked = (await linking.linksTouching(tx, "bank_transaction", ids)).length;
    if (linked > 0)
      return {
        error: violation(`${linked} transaction(s) of this import are linked — unlink them first`, {
          linked,
        }),
      };
  }
  // F98: the rows' proposals first — their composite FK is RESTRICT, and D63 forbids a cascade across modules
  await linking.dropProposalsFor(tx, ids);
  try {
    await tx.bankTransaction.deleteMany({ where: { bankImportId: id } });
    await tx.bankImport.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Error && e.message.includes("document_linked"))
      return { error: violation("A transaction of this import is linked — unlink it first") };
    throw e;
  }
  await audit.log({
    action: "delete",
    entityType: "bank_import",
    entityId: id,
    oldData: toAuditData(row),
    newData: { deletedTransactions: ids.length },
  });
  return { data: { id, deleted: ids.length } };
}
