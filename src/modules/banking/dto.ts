// The DTO mappers of the banking rows — a leaf: `import.ts`, `facts.ts` and `queries.ts` all read them and
// nothing here imports a service. Prisma rows never leave the module (constitution §2).
import type { BankImport, BankTransaction } from "@/generated/prisma/client";
import type { BankImportDto, BankTransactionDto } from "./types";

export const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** The stored `rate_source` of a row: `bank_transactions_rate_source_check` keeps `bank` out — the row *is* the bank. */
function rowRateSource(stored: BankTransaction["rateSource"]): BankTransactionDto["rateSource"] {
  if (stored === "bank")
    throw new Error("bank_transactions.rate_source = bank — the CHECK should refuse it");
  return stored;
}

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
    // the base, written once by the import (F113)
    amountBase: row.amountBase.toFixed(2),
    rate: row.rate.toString(),
    rateSource: rowRateSource(row.rateSource),
    rateDate: iso(row.rateDate),
    // the owner's facts
    basCode: row.basCode,
    partnerId: row.partnerId,
    note: row.note,
    noDocumentNeeded: row.noDocumentNeeded,
    categorisedBy: row.categorisedBy,
    ruleId: row.ruleId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
