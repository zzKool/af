import { describe, expect, it } from "vitest";
import {
  clampWidth,
  dropColumn,
  EMPTY_LAYOUT,
  isDefaultLayout,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveColumn,
  normalizeLayout,
  orderColumns,
} from "./layout";

const columns = [
  { key: "name", header: "Name" },
  { key: "amount", header: "Amount" },
  { key: "date", header: "Date" },
  { key: "actions", header: "" }, // pinned: row actions
];

describe("normalizeLayout", () => {
  it("reads a stored layout back and drops anything malformed", () => {
    expect(normalizeLayout(null)).toEqual(EMPTY_LAYOUT);
    expect(normalizeLayout("x")).toEqual(EMPTY_LAYOUT);
    expect(
      normalizeLayout({
        hidden: ["a", 1, null],
        order: ["b", "b", "c", {}],
        widths: { a: 120.4, b: "wide", c: Number.NaN, d: 5, e: 99999 },
        junk: true,
      }),
    ).toEqual({
      hidden: ["a"],
      order: ["b", "c"],
      widths: { a: 120, d: MIN_COLUMN_WIDTH, e: MAX_COLUMN_WIDTH },
    });
  });
});

describe("orderColumns", () => {
  it("keeps the default order without a stored one, pinned columns last", () => {
    expect(orderColumns(columns, []).map((c) => c.key)).toEqual([
      "name",
      "amount",
      "date",
      "actions",
    ]);
  });

  it("applies the stored order, appends columns it does not know, ignores keys that are gone", () => {
    expect(orderColumns(columns, ["date", "gone", "name"]).map((c) => c.key)).toEqual([
      "date",
      "name",
      "amount",
      "actions",
    ]);
  });

  it("never lets a stored order move a pinned column", () => {
    expect(orderColumns(columns, ["actions", "amount"]).map((c) => c.key)).toEqual([
      "amount",
      "name",
      "date",
      "actions",
    ]);
  });
});

describe("moveColumn / dropColumn", () => {
  it("moves by delta among the movable columns, clamped to the ends", () => {
    expect(moveColumn(columns, [], "date", -1)).toEqual(["name", "date", "amount"]);
    expect(moveColumn(columns, [], "date", -5)).toEqual(["date", "name", "amount"]);
    expect(moveColumn(columns, [], "name", 1)).toEqual(["amount", "name", "date"]);
    expect(moveColumn(columns, [], "name", 0)).toEqual(["name", "amount", "date"]);
    expect(moveColumn(columns, [], "nope", 1)).toEqual(["name", "amount", "date"]);
  });

  it("builds on the stored order", () => {
    expect(moveColumn(columns, ["date", "name", "amount"], "amount", -2)).toEqual([
      "amount",
      "date",
      "name",
    ]);
  });

  it("drops a column onto another: it takes that place", () => {
    expect(dropColumn(columns, [], "date", "name")).toEqual(["date", "name", "amount"]);
    expect(dropColumn(columns, [], "name", "date")).toEqual(["amount", "date", "name"]);
    expect(dropColumn(columns, [], "name", "name")).toEqual(["name", "amount", "date"]);
    expect(dropColumn(columns, [], "name", "actions")).toEqual(["name", "amount", "date"]);
  });
});

describe("clampWidth / isDefaultLayout", () => {
  it("clamps and rounds", () => {
    expect(clampWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(123.6)).toBe(124);
    expect(clampWidth(1e6)).toBe(MAX_COLUMN_WIDTH);
  });

  it("a layout equal to the columns' defaults is default", () => {
    expect(isDefaultLayout({ ...EMPTY_LAYOUT, hidden: ["b", "a"] }, ["a", "b"])).toBe(true);
    expect(isDefaultLayout({ ...EMPTY_LAYOUT, hidden: [] }, ["a"])).toBe(false);
    expect(isDefaultLayout({ ...EMPTY_LAYOUT, order: ["a"] }, [])).toBe(false);
    expect(isDefaultLayout({ ...EMPTY_LAYOUT, widths: { a: 100 } }, [])).toBe(false);
  });
});
