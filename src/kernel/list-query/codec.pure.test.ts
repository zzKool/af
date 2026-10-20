import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseFilter, parseListQuery, serializeFilter, serializeListQuery } from "./codec";
import type { Filter, ListQuery } from "./types";

const COLUMNS = ["name", "types", "amount", "date", "isActive"] as const;

describe("ListQuery codec", () => {
  it("parses a full URL and drops what it does not know", () => {
    const p = new URLSearchParams(
      "page=2&size=50&sort=name:asc,date:desc,nope:asc&q=acme&f.types=in:client|vendor|~blank~&f.name=text:contains:a%7Cb&f.amount=range:0:1000&f.date=dates:2026|2026-09-15|from=2026-01-01&f.nope=in:x&f.bad=garbage",
    );
    const q = parseListQuery(p, { columns: COLUMNS });
    expect(q).toEqual({
      page: 2,
      pageSize: 50,
      sort: [
        { col: "name", dir: "asc" },
        { col: "date", dir: "desc" },
      ],
      search: "acme",
      filters: {
        types: { kind: "in", values: ["client", "vendor", null] },
        name: { kind: "text", op: "contains", value: "a|b" },
        amount: { kind: "range", min: "0", max: "1000" },
        date: { kind: "dates", years: [2026], days: ["2026-09-15"], from: "2026-01-01" },
      },
    });
  });

  it("a clean query gives a clean URL; defaults are not written", () => {
    const q: ListQuery = {
      page: 1,
      pageSize: 25,
      sort: [{ col: "name", dir: "asc" }],
      filters: {},
    };
    expect(serializeListQuery(q, { defaultSort: [{ col: "name", dir: "asc" }] }).toString()).toBe(
      "",
    );
    expect(serializeListQuery({ ...q, page: 3, pageSize: 100 }).toString()).toBe(
      "page=3&size=100&sort=name%3Aasc",
    );
  });

  it("tolerates garbage: bad page, unknown size, malformed filters", () => {
    const q = parseListQuery(
      new URLSearchParams("page=-4&size=7&f.amount=range:abc:1&f.name=text:like:x"),
      {
        columns: COLUMNS,
      },
    );
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(25);
    expect(q.filters).toEqual({});
  });

  it("accepts Next.js searchParams objects too", () => {
    const q = parseListQuery(
      { page: "2", "f.isActive": "in:true", q: ["x", "y"] },
      { columns: COLUMNS },
    );
    expect(q.page).toBe(2);
    expect(q.search).toBe("x");
    expect(q.filters.isActive).toEqual({ kind: "in", values: ["true"] });
  });

  const arbFilter: fc.Arbitrary<Filter> = fc.oneof(
    fc.record({
      kind: fc.constant("in" as const),
      values: fc.array(fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)), {
        minLength: 1,
        maxLength: 5,
      }),
    }),
    fc.oneof(
      fc.record({
        kind: fc.constant("text" as const),
        op: fc.constantFrom("contains" as const, "startsWith" as const, "equals" as const),
        value: fc.string(),
      }),
      fc.record({
        kind: fc.constant("text" as const),
        op: fc.constantFrom("empty" as const, "notEmpty" as const),
      }),
    ),
    fc.oneof(
      fc.record({
        kind: fc.constant("range" as const),
        min: fc.constant("-12.50"),
        max: fc.constant("3"),
      }),
      fc.record({ kind: fc.constant("range" as const), min: fc.constant("0") }),
      fc.record({ kind: fc.constant("range" as const), empty: fc.constant(true) }),
    ),
    fc.oneof(
      fc.record({
        kind: fc.constant("dates" as const),
        years: fc.array(fc.integer({ min: 2000, max: 2099 }), { minLength: 1, maxLength: 3 }),
        months: fc.array(fc.constantFrom("2026-01", "2026-12"), { maxLength: 2 }),
        days: fc.array(fc.constantFrom("2026-03-11", "2026-10-20"), { maxLength: 2 }),
      }),
      fc.record({
        kind: fc.constant("dates" as const),
        from: fc.constant("2026-01-01"),
        to: fc.constant("2026-03-31"),
      }),
      fc.record({ kind: fc.constant("dates" as const), empty: fc.constant(true) }),
    ),
  );

  it("property: every filter survives serialize → parse (through a real URLSearchParams)", () => {
    fc.assert(
      fc.property(arbFilter, (f) => {
        const p = new URLSearchParams();
        p.set("f.c", serializeFilter(f));
        const back = parseFilter(new URLSearchParams(p.toString()).get("f.c") ?? "");
        const normalise = (x: Filter | null) =>
          JSON.parse(
            JSON.stringify(x, (_k, v) => (Array.isArray(v) && v.length === 0 ? undefined : v)),
          );
        expect(normalise(back)).toEqual(normalise(f));
      }),
    );
  });
});
