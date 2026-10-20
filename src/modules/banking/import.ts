// Bank import (specs/banking/spec.md US1, D25): one Nordea CSV → immutable transactions + journal entries,
// deduplicated per account, the file stored as a document, the rules applied to the new rows, one import
// record — all in the caller's transaction. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import type { BankImport, BankTransaction, Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { type AppError, RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import type { StorageService } from "@/kernel/storage/storage";
import * as documents from "@/modules/documents";
import * as journal from "@/modules/journal";
import { accountLabel } from "./bank-accounts";
import { type BankFormatConfig, headerError, type ParsedRow, parse } from "./csv-parser";
import { applyToEntries, type EntryTarget, ensureDefaultRules } from "./rules";
import type { BankImportDto, BankTransactionDto, ImportSummary } from "./types";

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
  bankAccountId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
});

// --- DTO mapping ---

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function toTransactionDto(row: BankTransaction): BankTransactionDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    bankAccountId: row.bankAccountId,
    bankImportId: row.bankImportId,
    bookingDate: iso(row.bookingDate) ?? "",
    amount: row.amount.toFixed(2),
    currency: row.currency,
    balance: row.balance ? row.balance.toFixed(2) : null,
    sender: row.sender,
    recipient: row.recipient,
    name: row.name,
    additionalDetails: row.additionalDetails,
    message: row.message,
    ownNotes: row.ownNotes,
    description: row.description,
    reference: row.reference,
    counterpartyKey: row.counterpartyKey,
    dedupHash: row.dedupHash,
    occurrence: row.occurrence,
    rowIndex: row.rowIndex,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

export function toImportDto(row: BankImport): BankImportDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    bankAccountId: row.bankAccountId,
    fileName: row.fileName,
    documentId: row.documentId,
    recordCount: row.recordCount,
    importedCount: row.importedCount,
    duplicateCount: row.duplicateCount,
    errorCount: row.errorCount,
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : [],
    periodFrom: iso(row.periodFrom),
    periodTo: iso(row.periodTo),
    importedAt: row.importedAt,
    createdBy: row.createdBy,
  };
}

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

/** `Bank_Plusgirokonto-SEK_2026-07-01_2026-07-31.csv` — the stored statement's business key (D13). */
export function statementKey(label: string, from: string | null, to: string | null): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `Bank_${slug}_${from ?? "x"}_${to ?? "x"}.csv`;
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
  const config = formatConfig(account.bankFormat);

  // 1. parse
  const result = parse(input.bytes, config);
  if (result.rows.length === 0) {
    const first = result.errors[0] ?? "No data rows found";
    return {
      error: first.startsWith("Unexpected columns")
        ? invalid(`Not a ${account.bankFormat.bankName} export — ${first}`, {
            bankName: account.bankFormat.bankName,
          })
        : invalid(first),
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

  // 4. every new row needs a base rate — checked before anything is written (a returned error does not
  //    roll the transaction back; a service never leaves half an import behind)
  for (const date of [...new Set(fresh.map((r) => r.date))]) {
    const r = await journal.resolveRate(tx, date, account.currency);
    if (r.error) return { error: r.error };
  }

  // 5. the statement as a document (even when every row was a duplicate — the package needs the file);
  //    the blob goes out first: if a later step throws, the row rolls back and the blob is an orphan at worst
  const stored = await documents.storeGeneratedDocument(tx, caller, audit, storage, {
    bytes: input.bytes,
    businessKey: statementKey(label, periodFrom, periodTo),
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
      errorCount: result.errors.length,
      errors: result.errors,
      periodFrom: periodFrom ? new Date(`${periodFrom}T00:00:00Z`) : null,
      periodTo: periodTo ? new Date(`${periodTo}T00:00:00Z`) : null,
      createdBy: caller.userId,
      source: caller.source,
    },
  });

  // 7. the transactions, in file order
  const created = fresh.length
    ? await tx.bankTransaction.createManyAndReturn({
        data: fresh.map((r) => transactionRow(caller, account.id, importRow.id, r)),
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

  // 8. one journal entry per new transaction (SEK base — the rates were checked above)
  const entries = await journal.createBankEntries(
    tx,
    caller,
    audit,
    created.map((t) => ({
      sourceId: t.id,
      entryDate: iso(t.bookingDate) as string,
      description: t.description,
      counterpartyKey: t.counterpartyKey,
      amount: t.amount.toFixed(2),
      currency: t.currency,
    })),
  );
  if (entries.error) throw new RollbackError(entries.error);

  // 9. rules on the new rows (the defaults first, when the tenant has none yet)
  const defaults = await ensureDefaultRules(tx, caller, audit);
  if (defaults.error) throw new RollbackError(defaults.error);
  const rules = await tx.categorisationRule.findMany({ where: { isActive: true } });
  const entryBySource = new Map(entries.data.map((e) => [e.sourceId as string, e]));
  const targets: EntryTarget[] = created.flatMap((t) => {
    const e = entryBySource.get(t.id);
    if (!e) return [];
    return [
      {
        entryId: e.id,
        transactionId: t.id,
        description: t.description,
        text: {
          counterpartyKey: t.counterpartyKey,
          name: t.name,
          additionalDetails: t.additionalDetails,
          message: t.message,
          sender: t.sender,
          recipient: t.recipient,
        },
      },
    ];
  });
  const applied = await applyToEntries(tx, caller, audit, rules, targets);
  if (applied.error) throw new RollbackError(applied.error);

  await audit.log({
    action: "create",
    entityType: "bank_import",
    entityId: importRow.id,
    newData: toAuditData(importRow),
  });

  return {
    data: {
      ...toImportDto(importRow),
      accountLabel: label,
      transactionIds: created.map((t) => t.id),
      categorised: applied.data.applied,
    },
  };
}

function transactionRow(
  caller: CallerIdentity,
  bankAccountId: string,
  bankImportId: string,
  r: ParsedRow,
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
    createdBy: caller.userId,
    source: caller.source,
  };
}

export function formatConfig(format: {
  delimiter: string;
  decimalSeparator: string;
  dateFormat: string;
  encoding: string;
  columnMapping: unknown;
}): BankFormatConfig {
  return {
    delimiter: format.delimiter,
    decimalSeparator: format.decimalSeparator,
    dateFormat: format.dateFormat,
    encoding: format.encoding,
    columnMapping: format.columnMapping as BankFormatConfig["columnMapping"],
  };
}

/** Delete an import with its transactions and their journal entries — refused when any transaction is linked. */
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
    const linked = await tx.link.count({
      where: {
        OR: [
          { fromType: "bank_transaction", fromId: { in: ids } },
          { toType: "bank_transaction", toId: { in: ids } },
        ],
      },
    });
    if (linked > 0)
      return {
        error: violation(`${linked} transaction(s) of this import are linked — unlink them first`, {
          linked,
        }),
      };
  }
  const entries = await journal.deleteBySource(tx, caller, audit, "bank_transaction", ids);
  if (entries.error) return { error: entries.error };
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
