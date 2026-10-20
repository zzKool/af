// The dedup property (specs/banking SC-002, D25): over random files, re-importing yields 0 new rows, a strict
// superset yields exactly the extra rows, identical rows in one file are all kept (occurrence index).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type BankFormatConfig, parse } from "./csv-parser";
import { dedupKey, planImport } from "./import";

const CONFIG: BankFormatConfig = {
  delimiter: ";",
  decimalSeparator: ",",
  dateFormat: "YYYY/MM/DD",
  encoding: "ISO-8859-1",
  columnMapping: {
    columns: [
      { index: 0, field: "date", label: "Booking date", aliases: ["Date"] },
      { index: 1, field: "amount", label: "Amount" },
      { index: 2, field: "sender", label: "Sender" },
      { index: 3, field: "recipient", label: "Recipient" },
      { index: 4, field: "name", label: "Name" },
      { index: 5, field: "details", label: "Additional details" },
      { index: 6, field: "message", label: "Message" },
      { index: 7, field: "notes", label: "Own notes" },
      { index: 8, field: "balance", label: "Balance" },
      { index: 9, field: "currency", label: "Currency" },
    ],
    hasHeader: true,
    skipRows: 0,
    trailingDelimiter: true,
    primaryDescriptionField: "name",
    referenceField: "message",
  },
};
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

const cell = fc.stringMatching(/^[A-Za-z0-9 *-]{0,12}$/);
const row = fc.record({
  day: fc.integer({ min: 1, max: 28 }),
  cents: fc.integer({ min: -500_000, max: 500_000 }).filter((n) => n !== 0),
  name: cell,
  details: cell,
  message: cell,
  notes: cell,
  balance: fc.option(fc.integer({ min: 0, max: 9_999_999 }), { nil: null }),
});
type Row = typeof row extends fc.Arbitrary<infer T> ? T : never;

const line = (r: Row): string =>
  [
    `2026/07/${String(r.day).padStart(2, "0")}`,
    `${(r.cents / 100).toFixed(2).replace(".", ",")}`,
    "",
    "",
    r.name,
    r.details,
    r.message,
    r.notes,
    r.balance === null ? "" : `${(r.balance / 100).toFixed(2).replace(".", ",")}`,
    "SEK",
    "",
  ].join(";");

const file = (rows: Row[]): Buffer => Buffer.from([HEADER, ...rows.map(line)].join("\n"), "latin1");
const keysOf = (rows: Row[]) =>
  new Set(parse(file(rows), CONFIG).rows.map((r) => dedupKey(r.dedupHash, r.occurrence)));

describe("dedup property (D25)", () => {
  it("re-importing any file yields 0 new rows; identical rows in one file are all kept", () => {
    fc.assert(
      fc.property(fc.array(row, { minLength: 1, maxLength: 30 }), (rows) => {
        const parsed = parse(file(rows), CONFIG).rows;
        expect(parsed).toHaveLength(rows.length);
        const existing = keysOf(rows);
        expect(existing.size).toBe(rows.length); // occurrence keeps duplicates distinct
        const plan = planImport(existing, parsed);
        expect(plan.fresh).toHaveLength(0);
        expect(plan.duplicates).toBe(rows.length);
      }),
      { numRuns: 200 },
    );
  });

  it("a strict superset (rows added anywhere) imports exactly the extra rows", () => {
    fc.assert(
      fc.property(
        fc.array(row, { minLength: 1, maxLength: 20 }),
        fc.array(row, { minLength: 1, maxLength: 10 }),
        fc.nat(),
        (base, extra, at) => {
          const existing = keysOf(base);
          const pos = at % (base.length + 1);
          const superset = [...base.slice(0, pos), ...extra, ...base.slice(pos)];
          const parsed = parse(file(superset), CONFIG).rows;
          const plan = planImport(existing, parsed);
          // the extra rows may duplicate base rows (same cells) — then they are legitimately "fresh" occurrences
          expect(plan.fresh.length).toBe(extra.length);
          expect(plan.duplicates).toBe(base.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("balance and own notes never take part in the key", () => {
    fc.assert(
      fc.property(
        row,
        cell,
        fc.option(fc.integer({ min: 0, max: 9_999_999 }), { nil: null }),
        (r, notes, bal) => {
          const a = keysOf([r]);
          const b = keysOf([{ ...r, notes, balance: bal }]);
          expect([...a]).toEqual([...b]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
