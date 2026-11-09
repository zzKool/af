// The month card of the Close page (F155, the Pulse-Close board) — pure. What the accountant's package of one month
// would hold if built now, read as five checks and the zip's tree. Nothing here is stored: every check is counted
// from the collected period (the same data the build writes) and the ECB coverage; a check is open while its count
// of open items is above zero. Building is never blocked — the open items are notes.md's flags.
import { addDays } from "@/kernel/clock/calendar";
import type { PackageFolder, PeriodData } from "./types";
import { NOTES_FILE, STATEMENTS_DIR, SUMMARY_FILE } from "./zip";

export const CLOSE_CHECKS = ["bank", "justified", "documents", "invoices", "rates"] as const;
export type CloseCheckKey = (typeof CLOSE_CHECKS)[number];

export type CloseCheck = {
  key: CloseCheckKey;
  /** items still to do (0 = the check is done) */
  open: number;
  /** items the check is about (bank lines, documents, invoices; accounts for `bank`) */
  total: number;
  /** `bank`: the statement lines; `rates`: the newest day every pair has a rate for */
  lines?: number;
  date?: string | null;
};

export type CloseZipEntry = {
  /** `bank-statements/`, `client-invoices/`, `summary.xlsx`, `notes.md` */
  name: string;
  kind: "statements" | PackageFolder | "summary" | "notes";
  files: number;
};

export type CloseMonth = {
  /** `2026-07` */
  period: string;
  checks: CloseCheck[];
  zip: CloseZipEntry[];
  /** every file of the zip, and the stored documents' bytes (the statements and sheets are small) */
  files: number;
  bytes: number;
  flags: number;
};

const FOLDERS: readonly PackageFolder[] = [
  "client-invoices",
  "supplier-invoices",
  "expenses",
  "documents",
];

const isWeekend = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/**
 * The day the ECB coverage must reach for the month: its last weekday, or — while the month runs — the weekday two
 * days back (the ECB publishes around 16:00 CET). A TARGET closing day at a month's end is tolerated: up to three
 * days short still counts as covered.
 */
export function ratesTarget(monthEnd: string, today: string): string {
  const settled = addDays(today, -2);
  let day = monthEnd < settled ? monthEnd : settled;
  while (isWeekend(day)) day = addDays(day, -1);
  return day;
}

/** The newest day every pair has a rate for (null when a pair has none). */
export function ratesCoveredTo(pairs: readonly { latestDate: string | null }[]): string | null {
  if (pairs.length === 0) return null;
  let min: string | null = pairs[0]?.latestDate ?? null;
  for (const p of pairs) {
    if (p.latestDate === null) return null;
    if (min === null || p.latestDate < min) min = p.latestDate;
  }
  return min;
}

export function closeMonth(
  data: PeriodData,
  rates: { coveredTo: string | null; today: string },
): CloseMonth {
  const kinds = new Map<string, number>();
  for (const f of data.flags) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
  const count = (...k: string[]) => k.reduce((s, kind) => s + (kinds.get(kind) ?? 0), 0);

  const accounts = new Set(data.bank.map((r) => r.account)).size;
  const unjustified = data.bank.filter((r) => r.flags.some((f) => f !== "mixed")).length;
  const target = ratesTarget(data.period.to, rates.today);
  const ratesOpen = rates.coveredTo === null || rates.coveredTo < addDays(target, -3) ? 1 : 0;

  const checks: CloseCheck[] = [
    { key: "bank", open: data.bank.length === 0 ? 1 : 0, total: accounts, lines: data.bank.length },
    { key: "justified", open: unjustified, total: data.bank.length },
    {
      key: "documents",
      open: count("missing_document", "document_not_ready"),
      total: data.documents.length,
    },
    { key: "invoices", open: count("unpaid_invoice"), total: data.income.length },
    { key: "rates", open: ratesOpen, total: 1, date: rates.coveredTo },
  ];

  // one statement file per account (`statementFiles`)
  const statements = accounts;
  const entries: CloseZipEntry[] = [
    { name: `${STATEMENTS_DIR}/`, kind: "statements", files: statements },
    ...FOLDERS.map((folder) => ({
      name: `${folder}/`,
      kind: folder,
      files: data.documents.filter((d) => d.folder === folder).length,
    })),
    { name: SUMMARY_FILE, kind: "summary", files: 1 },
    { name: NOTES_FILE, kind: "notes", files: 1 },
  ];
  const zip = entries.filter((e) => e.files > 0);

  return {
    period: data.period.period,
    checks,
    zip,
    files: statements + data.documents.length + 2,
    bytes: data.documents.reduce((s, d) => s + d.fileSize, 0),
    flags: data.flags.length,
  };
}
