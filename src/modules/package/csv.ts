// `bank-statements/*.csv` — pure (spec FR-002, harvest R3, §4.4): the rows of the period per account, as stored, in
// the account's own conventions (delimiter, decimal separator), ISO dates, plus the provenance columns (account,
// source file, row in the file). One file per account: `SEK.csv`, `CHF.csv` (the main accounts, by currency; the
// label disambiguates a second account of the same currency, R10), `savings.csv`.
import type { BankSheetRow } from "./types";

export const CSV_HEADER = [
  "Date",
  "Amount",
  "Currency",
  "Sender",
  "Recipient",
  "Name",
  "Additional details",
  "Message",
  "Own notes",
  "Balance",
  "Account",
  "Source file",
  "Row",
] as const;

const BOM = "﻿";

function quote(value: string, delimiter: string): string {
  return value.includes(delimiter) || value.includes('"') || /[\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function decimal(value: string | null, separator: string): string {
  return value === null ? "" : value.replace(".", separator);
}

export function slug(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/** The CSV of one account's rows (already in booking order), as text with a BOM. */
export function statementCsv(rows: readonly BankSheetRow[]): string {
  const first = rows[0];
  const delimiter = first?.delimiter ?? ";";
  const separator = first?.decimalSeparator ?? ",";
  const lines = [CSV_HEADER.join(delimiter)];
  for (const r of rows) {
    const cells = [
      r.bookingDate,
      decimal(r.amount, separator),
      r.currency,
      r.sender ?? "",
      r.recipient ?? "",
      r.name ?? "",
      r.additionalDetails ?? "",
      r.message ?? "",
      r.ownNotes ?? "",
      decimal(r.balance, separator),
      r.account,
      r.importFileName,
      String(r.rowIndex),
    ];
    lines.push(cells.map((c) => quote(c, delimiter)).join(delimiter));
  }
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

export type StatementFile = { name: string; account: string; rows: number; text: string };

/** The statement files of the period: one per account that has rows, named by currency (main) or `savings`. */
export function statementFiles(bank: readonly BankSheetRow[]): StatementFile[] {
  const byAccount = new Map<string, BankSheetRow[]>();
  for (const r of bank) {
    const list = byAccount.get(r.account) ?? [];
    list.push(r);
    byAccount.set(r.account, list);
  }
  const accounts = [...byAccount.entries()].sort(([a], [b]) => a.localeCompare(b));
  const currencyCount = new Map<string, number>();
  for (const [, rows] of accounts) {
    const r = rows[0];
    if (r && r.accountRole === "main")
      currencyCount.set(r.currency, (currencyCount.get(r.currency) ?? 0) + 1);
  }
  return accounts.map(([account, rows]) => {
    const r = rows[0] as BankSheetRow;
    const name =
      r.accountRole === "savings"
        ? "savings"
        : (currencyCount.get(r.currency) ?? 0) > 1
          ? `${r.currency}-${slug(account)}`
          : r.currency;
    return { name: `${name}.csv`, account, rows: rows.length, text: statementCsv(rows) };
  });
}
