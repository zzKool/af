// A minimal .xlsx writer (F111, audit 2026-10-27 D13): the package's summary workbook needs sheets of strings and
// numbers, a money format and column widths — nothing SheetJS's 1 MB and its advisories were buying. An .xlsx
// is a zip of a few XML parts (OOXML / SpreadsheetML); fflate (already a dependency for the package zip) writes
// the zip. Strings are inline (`t="inlineStr"`), so no shared-strings table; numbers are `<v>` with a style.
// Deterministic: the zip entries carry the caller's timestamp, the parts are written in a fixed order.
import { strToU8, type Zippable, zipSync } from "fflate";

export type XlsxCell = string | number | null | undefined;

export interface XlsxSheet {
  /** ≤ 31 characters, none of `\ / ? * [ ] :` — Excel's rule */
  name: string;
  header: readonly string[];
  rows: readonly (readonly XlsxCell[])[];
  /** 0-based column indexes whose numbers get the money format `#,##0.00` */
  moneyColumns?: readonly number[];
}

export interface XlsxWorkbook {
  title: string;
  author: string;
  /** the document's created / modified stamp — fixed by the caller so two builds are byte-identical */
  stamp: Date;
  sheets: readonly XlsxSheet[];
}

export const MONEY_FORMAT = "#,##0.00";
const MONEY_STYLE = 1; // cellXfs index in styles.xml below

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters; a tab / newline / CR in a cell is kept
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Excel's own width rule, roughly: the longest text + 2, capped — the same rule the SheetJS version used. */
export function columnWidths(sheet: XlsxSheet): number[] {
  return sheet.header.map((h, i) =>
    Math.min(60, Math.max(h.length, ...sheet.rows.map((r) => String(r[i] ?? "").length)) + 2),
  );
}

function cellXml(ref: string, value: XlsxCell, money: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return money
      ? `<c r="${ref}" s="${MONEY_STYLE}"><v>${value}</v></c>`
      : `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

export function sheetXml(sheet: XlsxSheet): string {
  const money = new Set(sheet.moneyColumns ?? []);
  const cols = columnWidths(sheet)
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const line = (cells: readonly XlsxCell[], r: number, isHeader: boolean) => {
    const xml = cells
      .map((v, c) => cellXml(`${columnLetter(c)}${r}`, v, !isHeader && money.has(c)))
      .join("");
    return `<row r="${r}">${xml}</row>`;
  };
  const rows = [
    line(sheet.header, 1, true),
    ...sheet.rows.map((cells, i) => line(cells, i + 2, false)),
  ].join("");
  const lastCol = columnLetter(Math.max(0, sheet.header.length - 1));
  const dimension = `A1:${lastCol}${sheet.rows.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rows}</sheetData></worksheet>`
  );
}

const CONTENT_TYPES = (count: number) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
  Array.from(
    { length: count },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("") +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
  `</Relationships>`;

const workbookXml = (sheets: readonly XlsxSheet[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
  `</workbook>`;

const workbookRels = (count: number) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("") +
  `<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

// one custom number format (id 164 — the first custom id), two cell styles: 0 = default, 1 = money
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="${esc(MONEY_FORMAT)}"/></numFmts>` +
  `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

const coreXml = (wb: XlsxWorkbook) => {
  const iso = wb.stamp.toISOString().replace(/\.\d{3}Z$/, "Z");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(wb.title)}</dc:title><dc:creator>${esc(wb.author)}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>` +
    `</cp:coreProperties>`
  );
};

const APP_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>AF</Application></Properties>`;

/** The workbook's bytes. */
export function writeXlsx(wb: XlsxWorkbook): Buffer {
  const parts: Record<string, string> = {
    "[Content_Types].xml": CONTENT_TYPES(wb.sheets.length),
    "_rels/.rels": ROOT_RELS,
    "docProps/core.xml": coreXml(wb),
    "docProps/app.xml": APP_XML,
    "xl/workbook.xml": workbookXml(wb.sheets),
    "xl/_rels/workbook.xml.rels": workbookRels(wb.sheets.length),
    "xl/styles.xml": STYLES,
  };
  wb.sheets.forEach((s, i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s);
  });
  const files: Zippable = {};
  for (const [name, xml] of Object.entries(parts)) {
    files[name] = [strToU8(xml), { level: 6, mtime: wb.stamp }];
  }
  return Buffer.from(zipSync(files, { mtime: wb.stamp }));
}
