// The counts read mapper (lessons audit 29): what `markBuilt` writes reads back unchanged; a stored value that
// does not fit reads as 0 for that key, never as a string or NaN on the month-end checklist.
import { describe, expect, it } from "vitest";
import { EMPTY_COUNTS, parsePackageCounts } from "./counts";
import type { PackageCounts } from "./types";

const full: PackageCounts = {
  bankRows: 8,
  invoices: 2,
  supplierInvoices: 1,
  expenses: 3,
  settlements: 1,
  documents: 4,
};

describe("parsePackageCounts", () => {
  it("reads back what markBuilt writes (a JSON round trip)", () => {
    expect(parsePackageCounts(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });

  it("the column default {} and a null column read as no counts", () => {
    expect(parsePackageCounts({})).toEqual(EMPTY_COUNTS);
    expect(parsePackageCounts(null)).toEqual(EMPTY_COUNTS);
  });

  it("an older build missing a key reads 0 for it", () => {
    expect(parsePackageCounts({ bankRows: 7, documents: 4 })).toEqual({
      ...EMPTY_COUNTS,
      bankRows: 7,
      documents: 4,
    });
  });

  it.each([
    ["a string", "7"],
    ["a fraction", 1.5],
    ["a negative", -1],
    ["null", null],
    ["an object", { n: 1 }],
  ] as const)("a count that is %s reads as 0", (_, bad) => {
    expect(parsePackageCounts({ bankRows: bad, invoices: 2 })).toEqual({
      ...EMPTY_COUNTS,
      invoices: 2,
    });
  });

  it("unknown keys are dropped; a column that is not an object reads as no counts", () => {
    expect(parsePackageCounts({ ...full, extra: 9 })).toEqual(full);
    for (const json of [[1, 2], "x", 3, true])
      expect(parsePackageCounts(json)).toEqual(EMPTY_COUNTS);
  });
});
