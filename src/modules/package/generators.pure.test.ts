// The pure generators over a fixture PeriodData (specs/accountant-package/spec.md FR-003 – FR-005, SC-002):
// the statement CSVs in the account's conventions, the summary's sheets and rows, notes.md's sections, the zip's
// layout — and determinism: the same data twice gives the same bytes.
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { CSV_HEADER, slug, statementCsv, statementFiles } from "./csv";
import { notesMd } from "./notes";
import {
  isPackagePeriod,
  lastDayOf,
  monthsBetween,
  monthsOf,
  parsePeriod,
  periodLabel,
} from "./period";
import { SHEETS, summaryRows, summaryXlsx } from "./summary";
import type { BankSheetRow, PeriodData } from "./types";
import { monthEntries, yearEntries, zipBytes } from "./zip";

const row = (over: Partial<BankSheetRow>): BankSheetRow => ({
  id: "r1",
  account: "Plusgirokonto SEK",
  accountRole: "main",
  bookingDate: "2026-06-12",
  amount: "-1250.00",
  currency: "SEK",
  balance: null,
  sender: null,
  recipient: null,
  name: "SKATTEPUNKTEN",
  additionalDetails: null,
  message: "9160",
  ownNotes: null,
  counterpartyKey: "SKATTEPUNKTEN",
  basCode: "6530",
  basLabel: "Redovisningstjänster",
  rate: "1",
  rateSource: "same_currency",
  amountBase: "-1250.00",
  related: ["SI213-Acc-01"],
  allocated: "1250.00",
  delta: "0.00",
  status: "linked",
  note: null,
  flags: [],
  importFileName: "PLUSGIROKONTO FTG 123 45 67-8 - 2026-06.csv",
  rowIndex: 3,
  delimiter: ";",
  decimalSeparator: ",",
  ...over,
});

const data: PeriodData = {
  period: parsePeriod("2026-06"),
  bank: [
    row({}),
    row({
      id: "r2",
      bookingDate: "2026-06-20",
      amount: "-40.00",
      name: 'Fee; "monthly"',
      message: null,
      related: [],
      allocated: "0.00",
      delta: "40.00",
      status: "open",
      basCode: null,
      basLabel: null,
      flags: ["unlinked"],
    }),
    row({
      id: "r3",
      account: "Plusgirokonto CHF",
      bookingDate: "2026-06-15",
      amount: "25000.00",
      currency: "CHF",
      name: "VAUDOISE",
      message: "VA26-INV-001",
      related: ["VA26-INV-001"],
      allocated: "25000.00",
      amountBase: "268750.00",
      rate: "10.75",
      rateSource: "ecb_daily",
    }),
    row({
      id: "r4",
      account: "Sparkonto",
      accountRole: "savings",
      bookingDate: "2026-05-31",
      amount: "12.50",
      name: "Ränta",
      message: null,
      related: [],
      allocated: "0.00",
      delta: "12.50",
      status: "open",
      importFileName: "SPARKONTO 1234 56 78901 - 2026.csv",
      rowIndex: 1,
    }),
  ],
  income: [
    {
      id: "i1",
      number: "VA26-INV-001",
      type: "invoice",
      client: "Vaudoise Assurances",
      issueDate: "2026-06-10",
      dueDate: "2026-07-10",
      periodLabel: "2026 May",
      currency: "CHF",
      net: "25000.00",
      vatRates: "0 %",
      vat: "0.00",
      total: "25000.00",
      totalBase: "268750.00",
      paid: "25000.00",
      remaining: "0.00",
      status: "paid",
      declarationPeriod: "2026/Q2",
      pdfKey: "InvoiceAF_VA26-INV-001.pdf",
      reason: "issued, paid",
      flags: [],
    },
  ],
  suppliers: [
    {
      id: "s1",
      key: "SI213-Acc-01",
      supplier: "Skattepunkten",
      invoiceNumber: "9160",
      invoiceDate: "2026-06-01",
      dueDate: "2026-06-30",
      currency: "SEK",
      net: "1000.00",
      vat: "250.00",
      total: "1250.00",
      amountBase: "1250.00",
      rateSource: "same_currency",
      basCode: "6530",
      basLabel: "Redovisningstjänster",
      paid: "1250.00",
      open: "0.00",
      status: "paid",
      paidVia: ["Plusgirokonto SEK 2026-06-12 -1250.00 SEK"],
      documentKey: "SI213-Acc-01_2026-06-01_Skattepunkten",
      reason: "dated, paid",
      note: null,
      flags: [],
    },
  ],
  expenses: [
    {
      id: "e1",
      group: "213 Zürich trip",
      key: "Ex213-Tr-01",
      description: "Train",
      date: "2026-06-03",
      basCode: "5800",
      basLabel: "Resekostnader",
      alias: "Tr",
      amount: "120.00",
      currency: "CHF",
      rateSource: "ecb_daily",
      amountBase: "1290.00",
      paidBy: "Private CH",
      status: "to_refund",
      refundDate: null,
      settlement: null,
      documentKey: "MISSING",
      reason: "dated",
      note: null,
      flags: ["missing document"],
    },
  ],
  settlements: [],
  links: [
    {
      id: "l1",
      fromType: "bank_transaction",
      fromKey: "Plusgirokonto SEK 2026-06-12 -1250.00 SEK",
      toType: "supplier_invoice",
      toKey: "SI213-Acc-01",
      kind: "justifies",
      allocated: "1250.00",
      currency: "SEK",
      createdAt: "2026-06-13T10:00:00.000Z",
    },
  ],
  flags: [
    { kind: "missing_document", entity: "expense", key: "Ex213-Tr-01", detail: "Train" },
    {
      kind: "unlinked_row",
      entity: "bank_transaction",
      key: "Plusgirokonto SEK 2026-06-20 -40.00 SEK",
      detail: 'Fee; "monthly"',
    },
  ],
  transfers: [
    {
      date: "2026-06-05",
      from: "Plusgirokonto SEK 2026-06-05 -10750.00 SEK",
      to: "Plusgirokonto CHF 2026-06-05 1000.00 CHF",
      implied: "0.093023",
    },
  ],
  liability: [{ source: "Private CH", currency: "CHF", openBase: "1290.00", openCount: 1 }],
  vatPeriods: [
    {
      declarationPeriod: "2026/Q2",
      currency: "CHF",
      count: 1,
      net: "25000.00",
      vat: "0.00",
      total: "25000.00",
    },
  ],
  documents: [
    {
      id: "d1",
      folder: "client-invoices",
      fileName: "InvoiceAF_VA26-INV-001.pdf",
      businessKey: "InvoiceAF_VA26-INV-001.pdf",
      mimeType: "application/pdf",
      fileSize: 3,
    },
    {
      id: "d2",
      folder: "supplier-invoices",
      fileName: "SI213-Acc-01_2026-06-01_Skattepunkten.pdf",
      businessKey: "SI213-Acc-01_2026-06-01_Skattepunkten",
      mimeType: "application/pdf",
      fileSize: 3,
    },
  ],
  collectedAt: "2026-07-01",
};

const bytes = new Map<string, Uint8Array>([
  ["d1", Buffer.from("pdf")],
  ["d2", Buffer.from("pdf")],
]);

describe("periods", () => {
  it("parses months and years, knows their bounds and labels", () => {
    expect(parsePeriod("2026-06")).toEqual({
      kind: "month",
      period: "2026-06",
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(parsePeriod("2026")).toEqual({
      kind: "year",
      period: "2026",
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(lastDayOf(2024, 2)).toBe("2024-02-29");
    expect(isPackagePeriod("2026-13")).toBe(false);
    expect(isPackagePeriod("26-06")).toBe(false);
    expect(() => parsePeriod("2026-6")).toThrow(/period/);
    expect(monthsOf("2026")[0]).toBe("2026-01");
    expect(monthsOf("2026")[11]).toBe("2026-12");
    expect(monthsBetween("2025-11", "2026-02")).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
      "2025-11",
    ]);
    expect(periodLabel("2026-06")).toBe("June 2026");
    expect(periodLabel("2026-06", "fr")).toBe("juin 2026");
    expect(periodLabel("2026")).toBe("2026");
  });
});

describe("bank-statements/*.csv", () => {
  it("writes the account's conventions, ISO dates, the provenance columns, and quotes what needs it", () => {
    const text = statementCsv(data.bank.slice(0, 2));
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER.join(";"));
    expect(lines[1]).toBe(
      "2026-06-12;-1250,00;SEK;;;SKATTEPUNKTEN;;9160;;;Plusgirokonto SEK;PLUSGIROKONTO FTG 123 45 67-8 - 2026-06.csv;3",
    );
    expect(lines[2]).toContain('"Fee; ""monthly"""');
    expect(text.startsWith("﻿")).toBe(true);
  });

  it("one file per account: the main accounts by currency, the savings account as savings.csv", () => {
    const files = statementFiles(data.bank);
    expect(files.map((f) => [f.name, f.rows])).toEqual([
      ["CHF.csv", 1],
      ["SEK.csv", 2],
      ["savings.csv", 1],
    ]);
    const twoSek = statementFiles([...data.bank, row({ id: "r5", account: "Företagskonto SEK" })]);
    expect(twoSek.map((f) => f.name)).toEqual([
      "SEK-foretagskonto-sek.csv",
      "CHF.csv",
      "SEK-plusgirokonto-sek.csv",
      "savings.csv",
    ]);
    expect(slug("Plusgirokonto SEK")).toBe("plusgirokonto-sek");
  });
});

describe("summary.xlsx", () => {
  it("has the seven sheets with the accountant's columns and derived statuses, money as numbers", () => {
    const wb = XLSX.read(summaryXlsx(data), { type: "buffer" });
    expect(wb.SheetNames).toEqual(Object.values(SHEETS));
    const bank = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[SHEETS.bank] as XLSX.WorkSheet,
    );
    expect(bank).toHaveLength(4);
    expect(bank[0]).toMatchObject({
      Account: "Plusgirokonto SEK",
      "Booking date": "2026-06-12",
      Amount: -1250,
      "Related documents": "SI213-Acc-01",
      Status: "linked",
      "Amount SEK": -1250,
    });
    expect(bank[1]).toMatchObject({ Status: "open", Flags: "unlinked", Delta: 40 });
    const income = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[SHEETS.income] as XLSX.WorkSheet,
    );
    expect(income[0]).toMatchObject({
      Number: "VA26-INV-001",
      Total: 25000,
      Status: "paid",
      PDF: "InvoiceAF_VA26-INV-001.pdf",
      "In this package because": "issued, paid",
    });
    const expenses = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[SHEETS.expenses] as XLSX.WorkSheet,
    );
    expect(expenses[0]).toMatchObject({ Ref: "Ex213-Tr-01", Document: "MISSING" });
    const flags = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[SHEETS.flags] as XLSX.WorkSheet,
    );
    expect(flags).toHaveLength(2);
    expect(summaryRows(data).links[0]?.[4]).toBe("justifies");
  });

  it("is byte-identical for the same data (SC-002)", () => {
    expect(Buffer.compare(summaryXlsx(data), summaryXlsx(structuredClone(data)))).toBe(0);
  });
});

describe("notes.md", () => {
  it("lists the flags by kind, the transfer pairs, the liability and the VAT periods", () => {
    const md = notesMd(data);
    expect(md).toContain("# Accountant package 2026-06");
    expect(md).toContain("## Flags (2)");
    expect(md).toContain("### Missing documents (1)");
    expect(md).toContain("- expense **Ex213-Tr-01** — Train");
    expect(md).toContain("### Unlinked bank lines (1)");
    expect(md).toContain("(implied rate 0.093023)");
    expect(md).toContain("- Private CH: 1290.00 SEK open over 1 expense");
    expect(md).toContain("- 2026/Q2: 1 invoice, net 25000.00 CHF");
    expect(notesMd({ ...data, flags: [], transfers: [], liability: [], vatPeriods: [] })).toContain(
      "Nothing to ask about",
    );
  });
});

describe("the zip", () => {
  it("has the fixed layout under the period (R2) and every document under its business key", () => {
    const zip = zipBytes(monthEntries(data, bytes), data.period.to);
    const files = Object.keys(unzipSync(zip)).sort();
    expect(files).toEqual([
      "2026-06/bank-statements/CHF.csv",
      "2026-06/bank-statements/SEK.csv",
      "2026-06/bank-statements/savings.csv",
      "2026-06/client-invoices/InvoiceAF_VA26-INV-001.pdf",
      "2026-06/notes.md",
      "2026-06/summary.xlsx",
      "2026-06/supplier-invoices/SI213-Acc-01_2026-06-01_Skattepunkten.pdf",
    ]);
  });

  it("refuses to zip a document without bytes — a failed build, never a silent gap", () => {
    expect(() => monthEntries(data, new Map())).toThrow(/no bytes for document/);
  });

  it("is byte-identical for the same data (SC-002)", () => {
    const a = zipBytes(monthEntries(data, bytes), data.period.to);
    const b = zipBytes(monthEntries(structuredClone(data), bytes), data.period.to);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("the year: twelve monthly folders inside the year, the savings CSV and the yearly summary at its root (D31)", () => {
    const year: PeriodData = { ...data, period: parsePeriod("2026") };
    const june = data;
    const may: PeriodData = { ...data, period: parsePeriod("2026-05"), documents: [] };
    const files = Object.keys(
      unzipSync(zipBytes(yearEntries(year, [may, june], bytes), "2026-12-31")),
    ).sort();
    expect(files).toContain("2026/2026-06/summary.xlsx");
    expect(files).toContain("2026/2026-05/notes.md");
    expect(files).toContain("2026/2026-06/client-invoices/InvoiceAF_VA26-INV-001.pdf");
    expect(files).toContain("2026/bank-statements/savings.csv");
    expect(files).toContain("2026/summary.xlsx");
    expect(files).toContain("2026/notes.md");
    expect(files.filter((f) => f.startsWith("2026/bank-statements/"))).toEqual([
      "2026/bank-statements/savings.csv",
    ]);
  });
});
