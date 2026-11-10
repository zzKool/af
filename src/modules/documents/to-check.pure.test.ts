// What a field to check asks (F185, the board's "“07-08” — August 7 or July 8?"): an ambiguous numeric date → the two
// dates, a total that is not net + VAT → both, anything else → *is it right?*; a sure field (DI's high band, or the
// owner's word) asks nothing; an answer → the correction it writes. Invented values (D51).
import { describe, expect, it } from "vitest";
import type { ReadMark } from "./reading-marks";
import { checkAsk, correctionFor, printedAmbiguously, swappedDate } from "./to-check";

const mark = (key: ReadMark["key"], confidence: number | null, content?: string): ReadMark => ({
  key,
  confidence,
  box: null,
  content: content ?? null,
});

describe("swappedDate / printedAmbiguously", () => {
  it("swaps day and month when both could be a month and they differ", () => {
    expect(swappedDate("2026-08-07")).toBe("2026-07-08");
    expect(swappedDate("2026-03-14")).toBeNull(); // 14 is no month
    expect(swappedDate("2026-05-05")).toBeNull(); // the same either way
    expect(swappedDate("07-08")).toBeNull();
  });

  it("only a date printed with numbers, the year not first, is a guess", () => {
    for (const p of ["07-08", "07/08/2026", "8.7.26", "07-08 "])
      expect(printedAmbiguously(p)).toBe(true);
    for (const p of ["2026-08-07", "14 March 2026", "7 Aug", "", "07-08 (30 dgr)"])
      expect(printedAmbiguously(p)).toBe(false);
  });
});

describe("checkAsk", () => {
  it("a sure field asks nothing — DI's high band, or the owner's correction", () => {
    expect(checkAsk(mark("invoiceNumber", 0.95), { invoiceNumber: "30418" })).toBeNull();
    expect(
      checkAsk(mark("invoiceNumber", 0.6), { invoiceNumber: "30418" }, ["invoiceNumber"]),
    ).toBeNull();
  });

  it("an ambiguous due date → the date as read, or day and month swapped", () => {
    expect(checkAsk(mark("dueDate", 0.72, "07-08"), { dueDate: "2026-08-07" })).toEqual({
      kind: "dateOrder",
      printed: "07-08",
      options: ["2026-08-07", "2026-07-08"],
    });
    // printed with its month's name: no guess, just *is it right?*
    expect(
      checkAsk(mark("invoiceDate", 0.8, "7 August 2026"), { invoiceDate: "2026-08-07" }),
    ).toEqual({ kind: "confirm" });
  });

  it("a total that is not net + VAT → the total as read, or net + VAT", () => {
    expect(
      checkAsk(mark("invoiceTotal", 0.7), { invoiceTotal: 1250, subtotal: 1000, totalTax: 260 }),
    ).toEqual({ kind: "total", options: ["1250.00", "1260.00"] });
    expect(
      checkAsk(mark("invoiceTotal", 0.7), { invoiceTotal: 1250, subtotal: 1000, totalTax: 250 }),
    ).toEqual({ kind: "confirm" });
  });

  it("anything else not sure → is it right?", () => {
    expect(checkAsk(mark("invoiceNumber", 0.81), { invoiceNumber: "INV-1" })).toEqual({
      kind: "confirm",
    });
    expect(checkAsk(mark("vendorName", null), { vendorName: "Kafé Solrosen" })).toEqual({
      kind: "confirm",
    });
  });
});

describe("correctionFor", () => {
  it("amounts as numbers (spaces and a comma accepted), dates as yyyy-mm-dd, text as typed", () => {
    expect(correctionFor("invoiceTotal", "1 269,00")).toEqual({ invoiceTotal: 1269 });
    expect(correctionFor("invoiceTotal", "1 269.50")).toEqual({ invoiceTotal: 1269.5 });
    expect(correctionFor("dueDate", "2026-07-08")).toEqual({ dueDate: "2026-07-08" });
    expect(correctionFor("dueDate", "07-08")).toBeNull();
    expect(correctionFor("invoiceNumber", " 30418 ")).toEqual({ invoiceNumber: "30418" });
    expect(correctionFor("vendorName", "  ")).toBeNull();
    expect(correctionFor("totalTax", "abc")).toBeNull();
  });
});
