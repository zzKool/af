import { describe, expect, it } from "vitest";
import {
  buildDateHierarchy,
  buildOrderBy,
  buildWhere,
  countDistinct,
  filterWhere,
  paginate,
} from "./prisma";
import type { ColumnMap, ListQuery } from "./types";

const COLUMNS: ColumnMap = {
  name: { type: "text", searchable: true },
  types: { type: "enum", array: true },
  currency: { type: "enum", field: "defaultCurrency" },
  amount: { type: "money", sum: true },
  days: { type: "number" },
  date: { type: "date", field: "bookingDate" },
  isActive: { type: "boolean" },
};

const base = (filters: ListQuery["filters"], extra: Partial<ListQuery> = {}): ListQuery => ({
  page: 1,
  pageSize: 25,
  sort: [],
  filters,
  ...extra,
});

describe("filterWhere per filter kind", () => {
  it("in: scalar, with blanks, mapped field, booleans, numbers", () => {
    expect(
      filterWhere("currency", COLUMNS.currency, { kind: "in", values: ["CHF", "SEK"] }),
    ).toEqual({
      defaultCurrency: { in: ["CHF", "SEK"] },
    });
    expect(
      filterWhere("currency", COLUMNS.currency, { kind: "in", values: ["CHF", null] }),
    ).toEqual({
      OR: [{ defaultCurrency: { in: ["CHF"] } }, { defaultCurrency: null }],
    });
    expect(filterWhere("isActive", COLUMNS.isActive, { kind: "in", values: ["true"] })).toEqual({
      isActive: true,
    });
    expect(
      filterWhere("isActive", COLUMNS.isActive, { kind: "in", values: ["true", "false"] }),
    ).toEqual({ OR: [{ isActive: true }, { isActive: false }] });
    expect(filterWhere("days", COLUMNS.days, { kind: "in", values: ["1", "2"] })).toEqual({
      days: { in: [1, 2] },
    });
  });

  it("in: array column uses hasSome / isEmpty", () => {
    expect(filterWhere("types", COLUMNS.types, { kind: "in", values: ["client", null] })).toEqual({
      OR: [{ types: { hasSome: ["client"] } }, { types: { isEmpty: true } }],
    });
  });

  it("text operators", () => {
    expect(
      filterWhere("name", COLUMNS.name, { kind: "text", op: "contains", value: "ab" }),
    ).toEqual({
      name: { contains: "ab", mode: "insensitive" },
    });
    expect(
      filterWhere("name", COLUMNS.name, { kind: "text", op: "startsWith", value: "V" }),
    ).toEqual({
      name: { startsWith: "V", mode: "insensitive" },
    });
    expect(filterWhere("name", COLUMNS.name, { kind: "text", op: "equals", value: "x" })).toEqual({
      name: { equals: "x", mode: "insensitive" },
    });
    expect(filterWhere("name", COLUMNS.name, { kind: "text", op: "empty" })).toEqual({
      OR: [{ name: null }, { name: "" }],
    });
    expect(filterWhere("name", COLUMNS.name, { kind: "text", op: "notEmpty" })).toEqual({
      AND: [{ name: { not: null } }, { name: { not: "" } }],
    });
  });

  it("range: money as Decimal, number as number, empty", () => {
    const w = filterWhere("amount", COLUMNS.amount, {
      kind: "range",
      min: "-10.50",
      max: "99",
    }) as {
      amount: { gte: { toString(): string }; lte: { toString(): string } };
    };
    expect(w.amount.gte.toString()).toBe("-10.5");
    expect(w.amount.lte.toString()).toBe("99");
    expect(filterWhere("days", COLUMNS.days, { kind: "range", min: "2" })).toEqual({
      days: { gte: 2 },
    });
    expect(filterWhere("amount", COLUMNS.amount, { kind: "range", empty: true })).toEqual({
      amount: null,
    });
  });

  it("dates: hierarchy union intersected with from/to; UTC day boundaries", () => {
    const w = filterWhere("date", COLUMNS.date, {
      kind: "dates",
      years: [2025],
      months: ["2026-02"],
      days: ["2026-10-20"],
      from: "2025-06-01",
      to: "2026-10-20",
    });
    expect(w).toEqual({
      AND: [
        {
          OR: [
            {
              bookingDate: {
                gte: new Date("2025-01-01T00:00:00Z"),
                lt: new Date("2026-01-01T00:00:00Z"),
              },
            },
            {
              bookingDate: {
                gte: new Date("2026-02-01T00:00:00Z"),
                lt: new Date("2026-03-01T00:00:00Z"),
              },
            },
            {
              bookingDate: {
                gte: new Date("2026-10-20T00:00:00Z"),
                lt: new Date("2026-10-21T00:00:00Z"),
              },
            },
          ],
        },
        {
          bookingDate: {
            gte: new Date("2025-06-01T00:00:00Z"),
            lt: new Date("2026-10-21T00:00:00Z"),
          },
        },
      ],
    });
    expect(filterWhere("date", COLUMNS.date, { kind: "dates", months: ["2026-12"] })).toEqual({
      bookingDate: { gte: new Date("2026-12-01T00:00:00Z"), lt: new Date("2027-01-01T00:00:00Z") },
    });
    expect(filterWhere("date", COLUMNS.date, { kind: "dates", empty: true })).toEqual({
      bookingDate: null,
    });
  });
});

describe("buildWhere / buildOrderBy / paginate", () => {
  it("combines filters, search over searchable columns and a base condition", () => {
    const q = base(
      { currency: { kind: "in", values: ["CHF"] }, types: { kind: "in", values: ["client"] } },
      { search: "acme" },
    );
    expect(buildWhere(q, COLUMNS, { base: { deletedAt: null } })).toEqual({
      AND: [
        { deletedAt: null },
        { defaultCurrency: { in: ["CHF"] } },
        { types: { hasSome: ["client"] } },
        { OR: [{ name: { contains: "acme", mode: "insensitive" } }] },
      ],
    });
  });

  it("exceptColumn leaves that column's filter out (Excel semantics for its distinct list)", () => {
    const q = base({
      currency: { kind: "in", values: ["CHF"] },
      types: { kind: "in", values: ["client"] },
    });
    expect(buildWhere(q, COLUMNS, { exceptColumn: "currency" })).toEqual({
      types: { hasSome: ["client"] },
    });
    expect(buildWhere(base({}), COLUMNS)).toEqual({});
  });

  it("unknown columns are ignored; order falls back; pagination is 1-based", () => {
    const q = base(
      { nope: { kind: "in", values: ["x"] } },
      { sort: [{ col: "nope", dir: "desc" }], page: 3, pageSize: 50 },
    );
    expect(buildWhere(q, COLUMNS)).toEqual({});
    expect(buildOrderBy(q, COLUMNS, [{ col: "name", dir: "asc" }])).toEqual([{ name: "asc" }]);
    expect(
      buildOrderBy(
        base(
          {},
          {
            sort: [
              { col: "date", dir: "desc" },
              { col: "name", dir: "asc" },
            ],
          },
        ),
        COLUMNS,
        [],
      ),
    ).toEqual([{ bookingDate: "desc" }, { name: "asc" }]);
    expect(paginate(q)).toEqual({ skip: 100, take: 50 });
  });
});

describe("distinct values and date hierarchy", () => {
  it("counts scalar values, blanks as null, most frequent first", () => {
    expect(countDistinct(["CHF", "SEK", "CHF", null, "", "EUR"], COLUMNS.currency)).toEqual([
      { value: "CHF", count: 2 },
      { value: null, count: 2 },
      { value: "EUR", count: 1 },
      { value: "SEK", count: 1 },
    ]);
  });

  it("unnests array columns", () => {
    expect(countDistinct([["client", "vendor"], ["client"], []], COLUMNS.types)).toEqual([
      { value: "client", count: 2 },
      { value: "vendor", count: 1 },
      { value: null, count: 1 },
    ]);
  });

  it("builds year → month → day counts, newest first, blanks counted", () => {
    const h = buildDateHierarchy([
      new Date("2026-10-20T00:00:00Z"),
      new Date("2026-10-20T00:00:00Z"),
      "2026-09-01",
      new Date("2025-12-31T00:00:00Z"),
      null,
    ]);
    expect(h.empty).toBe(1);
    expect(h.years.map((y) => [y.year, y.count])).toEqual([
      [2026, 3],
      [2025, 1],
    ]);
    expect(h.years[0].months.map((m) => [m.month, m.count])).toEqual([
      ["2026-10", 2],
      ["2026-09", 1],
    ]);
    expect(h.years[0].months[0].days).toEqual([{ day: "2026-10-20", count: 2 }]);
  });
});
