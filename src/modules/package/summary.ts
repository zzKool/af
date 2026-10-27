// `summary.xlsx` — pure (spec FR-003, harvest R5, §3): the read model as the sheets the accountant is used to —
// Bank statement, Income, Supplier invoices, Expenses, Settlements, Links, Flags. Nothing typed by hand; money as
// decimal strings with two decimals (numbers in the cells, two-decimal format), dates ISO. Written by
// `kernel/xlsx` (F111 — SheetJS left); the workbook's dates are fixed to the period's end so two builds are identical.
import { writeXlsx, type XlsxSheet } from "@/kernel/xlsx/xlsx";
import type { PeriodData } from "./types";

type Cell = string | number | null;
type Row = Cell[];

/** A decimal string becomes a number cell (the display boundary — the sheet is what the accountant reads). */
const n = (value: string | null | undefined): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

const sheet = (
  name: string,
  header: readonly string[],
  rows: readonly Row[],
  moneyColumns: readonly number[],
): XlsxSheet => ({ name, header, rows, moneyColumns });

export const SHEETS = {
  bank: "Bank statement",
  income: "Income",
  suppliers: "Supplier invoices",
  expenses: "Expenses",
  settlements: "Settlements",
  links: "Links",
  flags: "Flags",
} as const;

export const BANK_HEADER = [
  "Account",
  "Booking date",
  "Amount",
  "Currency",
  "Sender",
  "Recipient",
  "Name",
  "Additional details",
  "Message",
  "Own notes",
  "Balance",
  "Counterparty key",
  "BAS",
  "BAS label",
  "Rate",
  "Rate source",
  "Amount SEK",
  "Related documents",
  "Allocated",
  "Delta",
  "Status",
  "Note",
  "Flags",
] as const;

export const INCOME_HEADER = [
  "Number",
  "Type",
  "Client",
  "Issue date",
  "Due date",
  "Period",
  "Currency",
  "Net",
  "VAT %",
  "VAT",
  "Total",
  "Total SEK",
  "Paid",
  "Remaining",
  "Status",
  "VAT declaration period",
  "PDF",
  "In this package because",
  "Flags",
] as const;

export const SUPPLIER_HEADER = [
  "Ref",
  "Supplier",
  "Their invoice no",
  "Invoice date",
  "Due date",
  "Currency",
  "Net",
  "VAT",
  "Total",
  "Amount SEK",
  "Rate source",
  "BAS",
  "BAS label",
  "Paid",
  "Open",
  "Status",
  "Paid via",
  "Document",
  "In this package because",
  "Note",
  "Flags",
] as const;

export const EXPENSE_HEADER = [
  "Group",
  "Ref",
  "Description",
  "Date",
  "BAS",
  "BAS label",
  "Alias",
  "Amount",
  "Currency",
  "Rate source",
  "Amount SEK",
  "Paid by",
  "Status",
  "Refund booking date",
  "Settlement",
  "Document",
  "In this package because",
  "Note",
  "Flags",
] as const;

export const SETTLEMENT_HEADER = [
  "Number",
  "Booking date",
  "Paid by",
  "Refund",
  "Currency",
  "Refund SEK",
  "Allocated SEK",
  "Exchange difference SEK",
  "Rounding SEK",
  "Expenses",
  "Statement",
  "Flags",
] as const;

export const LINKS_HEADER = [
  "From type",
  "From",
  "To type",
  "To",
  "Kind",
  "Allocated",
  "Currency",
  "Created at",
] as const;

export const FLAGS_HEADER = ["Kind", "Entity", "Key", "Detail"] as const;

/** The rows of every sheet, as plain cells — what the test compares and what the workbook is built from. */
export function summaryRows(data: PeriodData): Record<keyof typeof SHEETS, Row[]> {
  return {
    bank: data.bank.map((r) => [
      r.account,
      r.bookingDate,
      n(r.amount),
      r.currency,
      r.sender,
      r.recipient,
      r.name,
      r.additionalDetails,
      r.message,
      r.ownNotes,
      n(r.balance),
      r.counterpartyKey,
      r.basCode,
      r.basLabel,
      r.rate === null ? null : Number(r.rate),
      r.rateSource,
      n(r.amountBase),
      r.related.join("; "),
      n(r.allocated),
      n(r.delta),
      r.status,
      r.note,
      r.flags.join("; "),
    ]),
    income: data.income.map((r) => [
      r.number,
      r.type,
      r.client,
      r.issueDate,
      r.dueDate,
      r.periodLabel,
      r.currency,
      n(r.net),
      r.vatRates,
      n(r.vat),
      n(r.total),
      n(r.totalBase),
      n(r.paid),
      n(r.remaining),
      r.status,
      r.declarationPeriod,
      r.pdfKey,
      r.reason,
      r.flags.join("; "),
    ]),
    suppliers: data.suppliers.map((r) => [
      r.key,
      r.supplier,
      r.invoiceNumber,
      r.invoiceDate,
      r.dueDate,
      r.currency,
      n(r.net),
      n(r.vat),
      n(r.total),
      n(r.amountBase),
      r.rateSource,
      r.basCode,
      r.basLabel,
      n(r.paid),
      n(r.open),
      r.status,
      r.paidVia.join("; "),
      r.documentKey,
      r.reason,
      r.note,
      r.flags.join("; "),
    ]),
    expenses: data.expenses.map((r) => [
      r.group,
      r.key,
      r.description,
      r.date,
      r.basCode,
      r.basLabel,
      r.alias,
      n(r.amount),
      r.currency,
      r.rateSource,
      n(r.amountBase),
      r.paidBy,
      r.status,
      r.refundDate,
      r.settlement,
      r.documentKey,
      r.reason,
      r.note,
      r.flags.join("; "),
    ]),
    settlements: data.settlements.map((r) => [
      r.number,
      r.bookingDate,
      r.paidBy,
      n(r.refundAmount),
      r.currency,
      n(r.refundBase),
      n(r.allocatedBase),
      n(r.exchangeDifferenceBase),
      n(r.roundingBase),
      r.expenses.join("; "),
      r.statementKey,
      r.flags.join("; "),
    ]),
    links: data.links.map((r) => [
      r.fromType,
      r.fromKey,
      r.toType,
      r.toKey,
      r.kind,
      n(r.allocated),
      r.currency,
      r.createdAt,
    ]),
    flags: data.flags.map((f) => [f.kind, f.entity, f.key, f.detail]),
  };
}

/** The workbook bytes. Deterministic: the document dates are the period's end, the rows are in collected order. */
export function summaryXlsx(data: PeriodData): Buffer {
  const rows = summaryRows(data);
  return writeXlsx({
    title: `Accountant package ${data.period.period}`,
    author: "AF",
    stamp: new Date(`${data.period.to}T00:00:00Z`),
    sheets: [
      sheet(SHEETS.bank, BANK_HEADER, rows.bank, [2, 10, 16, 18, 19]),
      sheet(SHEETS.income, INCOME_HEADER, rows.income, [7, 9, 10, 11, 12, 13]),
      sheet(SHEETS.suppliers, SUPPLIER_HEADER, rows.suppliers, [6, 7, 8, 9, 13, 14]),
      sheet(SHEETS.expenses, EXPENSE_HEADER, rows.expenses, [7, 10]),
      sheet(SHEETS.settlements, SETTLEMENT_HEADER, rows.settlements, [3, 5, 6, 7, 8]),
      sheet(SHEETS.links, LINKS_HEADER, rows.links, [5]),
      sheet(SHEETS.flags, FLAGS_HEADER, rows.flags, []),
    ],
  });
}
