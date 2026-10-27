import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx"; // dev-only: reads back what the writer produced (F111)
import { columnLetter, columnWidths, sheetXml, writeXlsx } from "./xlsx";

const stamp = new Date("2026-06-30T00:00:00Z");
const workbook = {
  title: "Accountant package 2026-06",
  author: "AF",
  stamp,
  sheets: [
    {
      name: "Bank statement",
      header: ["Account", "Booking date", "Amount", "Note"],
      rows: [
        ["Plusgiro SEK", "2026-06-02", -1297.2, "Skattepunkten <office> & co"],
        ["Plusgiro SEK", "2026-06-03", 10000, null],
        ["Sparkonto", "2026-06-30", 0.5, ""],
      ],
      moneyColumns: [2],
    },
    { name: "Flags", header: ["Kind", "Detail"], rows: [] },
  ],
};

describe("kernel/xlsx — the minimal writer", () => {
  it("column letters and widths follow Excel's rules", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual([
      "A",
      "Z",
      "AA",
      "AB",
      "ZZ",
      "AAA",
    ]);
    expect(columnWidths(workbook.sheets[0])).toEqual([14, 14, 9, 29]);
  });

  it("a sheet: inline strings escaped, numbers as values, money styled, the header never styled", () => {
    const xml = sheetXml(workbook.sheets[0]);
    expect(xml).toContain(
      '<c r="A1" t="inlineStr"><is><t xml:space="preserve">Account</t></is></c>',
    );
    expect(xml).toContain('<c r="C2" s="1"><v>-1297.2</v></c>');
    expect(xml).toContain("Skattepunkten &lt;office&gt; &amp; co");
    expect(xml).not.toContain('<c r="D3"'); // null and "" are no cell
    expect(xml).not.toContain('<c r="D4"');
    expect(xml).toContain('<dimension ref="A1:D4"/>');
    expect(xml).toContain('ySplit="1"'); // the header row frozen
  });

  it("the workbook opens in a reader: sheets by name, typed cells, the money format, the properties", () => {
    const bytes = writeXlsx(workbook);
    const wb = XLSX.read(bytes, { type: "buffer", cellNF: true });
    expect(wb.SheetNames).toEqual(["Bank statement", "Flags"]);
    const bank = wb.Sheets["Bank statement"] as XLSX.WorkSheet;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(bank);
    expect(rows[0]).toEqual({
      Account: "Plusgiro SEK",
      "Booking date": "2026-06-02",
      Amount: -1297.2,
      Note: "Skattepunkten <office> & co",
    });
    expect(bank.C2?.t).toBe("n");
    expect(bank.C2?.z).toBe("#,##0.00");
    expect(bank.A2?.t).toBe("s");
    expect(wb.Props?.Title).toBe("Accountant package 2026-06");
    expect(wb.Props?.Author).toBe("AF");
    expect(wb.Props?.CreatedDate?.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("is deterministic: the same input gives the same bytes, with the parts in a fixed order", () => {
    const a = writeXlsx(workbook);
    const b = writeXlsx(workbook);
    expect(Buffer.compare(a, b)).toBe(0);
    expect(Object.keys(unzipSync(new Uint8Array(a)))).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "docProps/app.xml",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
  });
});
