// The zip — pure (spec FR-005, harvest R2, R6): the fixed layout under `<period>/`, every entry with the period's end
// as its timestamp so two builds of the same data are byte-identical. fflate (synchronous; a package is a few MB).
import { type Zippable, zipSync } from "fflate";
import { statementFiles } from "./csv";
import { notesMd } from "./notes";
import { summaryXlsx } from "./summary";
import type { PackageDocument, PeriodData } from "./types";

export const SUMMARY_FILE = "summary.xlsx";
export const NOTES_FILE = "notes.md";
export const STATEMENTS_DIR = "bank-statements";

export type ZipEntry = { path: string; bytes: Uint8Array };

/** The document bytes the job fetched, by document id. A missing one is the job's error, never a silent gap. */
export type DocumentBytes = ReadonlyMap<string, Uint8Array>;

function bytesOf(doc: PackageDocument, bytes: DocumentBytes): Uint8Array {
  const b = bytes.get(doc.id);
  if (!b) throw new Error(`package: no bytes for document ${doc.businessKey} (${doc.id})`);
  return b;
}

/** The entries of one month's folder (`2026-06/…`), the whole monthly package. */
export function monthEntries(data: PeriodData, bytes: DocumentBytes): ZipEntry[] {
  const root = data.period.period;
  const entries: ZipEntry[] = [];
  for (const f of statementFiles(data.bank)) {
    entries.push({
      path: `${root}/${STATEMENTS_DIR}/${f.name}`,
      bytes: Buffer.from(f.text, "utf8"),
    });
  }
  for (const d of data.documents) {
    entries.push({ path: `${root}/${d.folder}/${d.fileName}`, bytes: bytesOf(d, bytes) });
  }
  entries.push({ path: `${root}/${SUMMARY_FILE}`, bytes: summaryXlsx(data) });
  entries.push({ path: `${root}/${NOTES_FILE}`, bytes: Buffer.from(notesMd(data), "utf8") });
  return entries;
}

/**
 * The year (D31): the twelve monthly folders inside `<year>/`, the savings rows of the year as
 * `<year>/bank-statements/savings.csv`, a yearly `summary.xlsx` and `notes.md` over the whole year.
 */
export function yearEntries(
  year: PeriodData,
  months: readonly PeriodData[],
  bytes: DocumentBytes,
): ZipEntry[] {
  const root = year.period.period;
  const entries: ZipEntry[] = [];
  for (const m of months) {
    for (const e of monthEntries(m, bytes)) entries.push({ ...e, path: `${root}/${e.path}` });
  }
  for (const f of statementFiles(year.bank.filter((r) => r.accountRole === "savings"))) {
    entries.push({
      path: `${root}/${STATEMENTS_DIR}/${f.name}`,
      bytes: Buffer.from(f.text, "utf8"),
    });
  }
  entries.push({ path: `${root}/${SUMMARY_FILE}`, bytes: summaryXlsx(year) });
  entries.push({ path: `${root}/${NOTES_FILE}`, bytes: Buffer.from(notesMd(year), "utf8") });
  return entries;
}

/** Deterministic: sorted paths, one fixed mtime, deflate level 6. */
export function zipBytes(entries: readonly ZipEntry[], mtime: string): Buffer {
  const stamp = new Date(`${mtime}T12:00:00Z`);
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const zippable: Zippable = {};
  for (const e of sorted) zippable[e.path] = [e.bytes, { mtime: stamp, level: 6 }];
  return Buffer.from(zipSync(zippable, { mtime: stamp }));
}
